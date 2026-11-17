<script setup>
/**
 * 通用指标卡
 * - 展示单个关键指标：标签 + 数值 + 单位 + 环比
 * - icon 可传 Element Plus 图标名（如 'Sunny'），也可用 #icon 插槽自定义
 * - 图标按需异步加载，避免把整套 @element-plus/icons-vue 打进首屏包
 * - 只负责展示，不含任何取数逻辑
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ name: 'AgriStatCard' })

const props = defineProps({
  // 指标名称
  label: { type: String, default: '' },
  // 指标值，字符串或数字
  value: { type: [String, Number], default: '' },
  // 单位，如 ℃ / % / lux
  unit: { type: String, default: '' },
  // 趋势方向：up 上升 / down 下降 / flat 持平
  trend: { type: String, default: '' },
  // 环比差值文案，如 '+2.3%'
  delta: { type: String, default: '' },
  // 色调：brand 主色 / warn 警告 / danger 危险 / ok 正常
  tone: { type: String, default: 'brand' },
  // Element Plus 图标名，如 'Sunny'
  icon: { type: String, default: '' },
  // 加载态：展示骨架占位
  loading: { type: Boolean, default: false }
})

// 图标模块只加载一次，多个卡片共用
let iconModulePromise = null

/**
 * 懒加载 Element Plus 图标集合。
 * @returns {Promise<Object>} 图标组件映射
 */
function loadIconModule() {
  if (!iconModulePromise) {
    iconModulePromise = import('@element-plus/icons-vue')
  }
  return iconModulePromise
}

const iconComponent = ref(null)

// 已卸载标记，避免异步回来后给已销毁组件赋值
let unmounted = false

watch(
  () => props.icon,
  async (name) => {
    if (!name) {
      iconComponent.value = null
      return
    }
    try {
      const icons = await loadIconModule()
      if (!unmounted) {
        iconComponent.value = icons[name] || null
      }
    } catch {
      // 图标加载失败不影响指标展示
      iconComponent.value = null
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  unmounted = true
})

// 趋势箭头文案
const trendArrow = computed(() => {
  if (props.trend === 'up') {
    return '↑'
  }
  if (props.trend === 'down') {
    return '↓'
  }
  if (props.trend === 'flat') {
    return '→'
  }
  return ''
})

// 趋势颜色：上升绿、下降红、持平灰
const trendClass = computed(() => {
  if (props.trend === 'up') {
    return 'is-up'
  }
  if (props.trend === 'down') {
    return 'is-down'
  }
  return 'is-flat'
})

// 是否展示环比区域
const showTrend = computed(() => Boolean(props.trend || props.delta))
</script>

<template>
  <div class="agri-stat-card" :class="`is-${tone}`">
    <div class="agri-stat-card__head">
      <span class="agri-stat-card__label">{{ label }}</span>
      <span class="agri-stat-card__icon">
        <slot name="icon">
          <el-icon v-if="iconComponent"><component :is="iconComponent" /></el-icon>
        </slot>
      </span>
    </div>

    <div v-if="loading" class="agri-stat-card__skeleton">
      <span class="agri-stat-card__skeleton-value" />
      <span class="agri-stat-card__skeleton-delta" />
    </div>

    <template v-else>
      <div class="agri-stat-card__value">
        <span class="agri-stat-card__number">{{ value }}</span>
        <span v-if="unit" class="agri-stat-card__unit">{{ unit }}</span>
      </div>
      <div v-if="showTrend" class="agri-stat-card__trend" :class="trendClass">
        <span v-if="trendArrow" class="agri-stat-card__arrow">{{ trendArrow }}</span>
        <span v-if="delta" class="agri-stat-card__delta">{{ delta }}</span>
        <span class="agri-stat-card__trend-label">较昨日同期</span>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.agri-stat-card {
  display: flex;
  flex-direction: column;
  gap: $space-sm;
  min-width: 0;
  padding: $space-md;
  background: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-card;
  border-left: 3px solid $primary-color;
}

// 四种色调只改左侧色条与图标底色，保持整体克制
.agri-stat-card.is-warn {
  border-left-color: $warning-color;
}

.agri-stat-card.is-danger {
  border-left-color: $danger-color;
}

.agri-stat-card.is-ok {
  border-left-color: $success-color;
}

.agri-stat-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
}

.agri-stat-card__label {
  font-size: $font-size-sm;
  color: $text-secondary;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.agri-stat-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: $radius-sm;
  font-size: $font-size-md;
  color: $primary-color;
  background: $primary-lighter;
}

.is-warn .agri-stat-card__icon {
  color: $warning-color;
  background: rgba($warning-color, 0.12);
}

.is-danger .agri-stat-card__icon {
  color: $danger-color;
  background: rgba($danger-color, 0.12);
}

.is-ok .agri-stat-card__icon {
  color: $success-color;
  background: rgba($success-color, 0.12);
}

.agri-stat-card__value {
  display: flex;
  align-items: baseline;
  gap: $space-xs;
  min-width: 0;
}

.agri-stat-card__number {
  font-size: $font-size-xl;
  font-weight: 600;
  line-height: 1.2;
  color: $text-primary;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.agri-stat-card__unit {
  flex: none;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.agri-stat-card__trend {
  display: flex;
  align-items: center;
  gap: $space-xs;
  font-size: $font-size-xs;
  min-width: 0;
}

.agri-stat-card__trend.is-up {
  color: $success-color;
}

.agri-stat-card__trend.is-down {
  color: $danger-color;
}

.agri-stat-card__trend.is-flat {
  color: $text-secondary;
}

.agri-stat-card__trend-label {
  color: $text-secondary;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.agri-stat-card__skeleton {
  display: flex;
  flex-direction: column;
  gap: $space-sm;
}

.agri-stat-card__skeleton-value,
.agri-stat-card__skeleton-delta {
  display: block;
  border-radius: $radius-sm;
  background: linear-gradient(90deg, $bg-page 25%, $border-color 37%, $bg-page 63%);
  background-size: 400% 100%;
  animation: agri-stat-shimmer 1.4s ease infinite;
}

.agri-stat-card__skeleton-value {
  width: 60%;
  height: 26px;
}

.agri-stat-card__skeleton-delta {
  width: 40%;
  height: 14px;
}

@keyframes agri-stat-shimmer {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
}

@media (max-width: $breakpoint-sm) {
  .agri-stat-card {
    padding: $space-sm;
  }
}
</style>
