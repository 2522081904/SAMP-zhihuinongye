<script setup>
/**
 * 通用 ECharts 容器
 * - echarts 按需引入（柱/折线/饼/仪表 + 常用组件 + Canvas 渲染器），避免全量包
 * - option 深度监听，变化时 setOption(notMerge: true) 全量替换
 * - 容器尺寸变化自动 resize，卸载时 dispose
 * - option 为空对象时展示 AgriEmpty，而不是一张空白画布
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import AgriEmpty from '@/components/AgriEmpty.vue'

// 按需注册：页面只用到这四类图，其余图表类型不进入构建产物
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer
])

defineOptions({ name: 'AgriChart' })

const props = defineProps({
  // ECharts option；空对象表示暂无数据
  option: { type: Object, default: () => ({}) },
  // 图表区高度，数字按 px 处理，也兼容 '320px' 这类字符串
  height: { type: [Number, String], default: 300 },
  loading: { type: Boolean, default: false },
  autoResize: { type: Boolean, default: true },
  // 主题名，默认不传（跟随 echarts 默认主题）
  theme: { type: String, default: '' },
  // 兼容旧骨架页的标题能力
  title: { type: String, default: '' },
  emptyText: { type: String, default: '暂无数据' },
  // 强制空态（业务上明确无数据时使用，优先级高于 option）
  empty: { type: Boolean, default: false }
})

const chartRef = ref(null)
const containerHeight = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height
)

const isEmpty = computed(
  () => props.empty || !props.option || Object.keys(props.option).length === 0
)

let chart = null
let resizeObserver = null
let usingWindowResize = false

/**
 * 读取全局 CSS 变量，保证 loader 颜色跟主题走，不在组件里写死品牌色。
 * @param {string} name 变量名
 * @param {string} fallback 兜底值
 * @returns {string} 颜色值
 */
function cssVar(name, fallback) {
  if (typeof window === 'undefined') {
    return fallback
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 把当前 props.option 应用到图表实例 */
function applyOption() {
  if (!chart) {
    return
  }
  if (isEmpty.value) {
    chart.clear()
    return
  }
  chart.setOption(props.option, { notMerge: true })
}

/** 同步 loading 遮罩 */
function applyLoading() {
  if (!chart) {
    return
  }
  if (props.loading) {
    chart.showLoading('default', {
      text: '加载中...',
      color: cssVar('--agri-primary', '#2e7d58'),
      textColor: cssVar('--agri-text-secondary', '#8b95a1'),
      maskColor: 'rgba(255, 255, 255, 0.72)'
    })
  } else {
    chart.hideLoading()
  }
}

/** 初始化图表实例（主题变化时会先销毁再重建） */
function initChart() {
  if (!chartRef.value) {
    return
  }
  disposeChart()
  chart = echarts.init(chartRef.value, props.theme || undefined)
  applyOption()
  applyLoading()
}

/** 销毁实例并解绑尺寸监听 */
function disposeChart() {
  if (chart) {
    chart.dispose()
    chart = null
  }
}

/** 容器尺寸变化时重绘，autoResize=false 时跳过 */
function handleResize() {
  if (props.autoResize && chart) {
    chart.resize()
  }
}

/** 绑定尺寸监听：优先 ResizeObserver，降级到 window.resize */
function bindResize() {
  if (typeof window === 'undefined') {
    return
  }
  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(handleResize)
    if (chartRef.value) {
      resizeObserver.observe(chartRef.value)
    }
  } else {
    window.addEventListener('resize', handleResize)
    usingWindowResize = true
  }
}

/** 解绑尺寸监听 */
function unbindResize() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (usingWindowResize) {
    window.removeEventListener('resize', handleResize)
    usingWindowResize = false
  }
}

onMounted(async () => {
  await nextTick()
  initChart()
  bindResize()
})

onBeforeUnmount(() => {
  unbindResize()
  disposeChart()
})

// option 深度监听：父组件直接替换对象或原地改 series 都能生效
watch(
  () => props.option,
  () => {
    applyOption()
  },
  { deep: true }
)

watch(
  () => props.empty,
  () => {
    applyOption()
  }
)

watch(
  () => props.loading,
  () => {
    applyLoading()
  }
)

// 主题只能在 init 时指定，变化后重建实例
watch(
  () => props.theme,
  () => {
    initChart()
  }
)
</script>

<template>
  <div class="agri-chart">
    <div v-if="title || $slots.extra" class="agri-chart__head">
      <span class="agri-chart__title">{{ title }}</span>
      <div class="agri-chart__extra">
        <slot name="extra" />
      </div>
    </div>

    <div class="agri-chart__body" :style="{ height: containerHeight }">
      <div ref="chartRef" class="agri-chart__canvas" />
      <!-- 空态覆盖在画布上，保证容器尺寸不塌陷、切回数据时无需重新 init -->
      <div v-if="isEmpty && !loading" class="agri-chart__empty">
        <AgriEmpty :description="emptyText" height="100%" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-chart {
  width: 100%;
  min-width: 0;
  padding: $space-md;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-card;
}

.agri-chart__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.agri-chart__title {
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.agri-chart__extra {
  font-size: $font-size-sm;
  color: $text-secondary;
}

.agri-chart__body {
  position: relative;
  width: 100%;
  min-width: 0;
}

.agri-chart__canvas {
  width: 100%;
  height: 100%;
}

.agri-chart__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
