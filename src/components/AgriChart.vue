<script setup>
/**
 * 图表占位组件
 * 骨架阶段只画占位框，不引入 echarts；后续接入时在此组件内部初始化图表实例，
 * 页面无需改动，只保留 :option 传参即可。
 */
defineOptions({ name: 'AgriChart' })

defineProps({
  // 图表标题
  title: {
    type: String,
    default: ''
  },
  // 图表高度
  height: {
    type: String,
    default: '320px'
  },
  // 图表配置（当前仅占位，接入 echarts 后直接使用）
  option: {
    type: Object,
    default: () => ({})
  }
})
</script>

<template>
  <div class="agri-chart" :style="{ height }">
    <div class="agri-chart__head">
      <span class="agri-chart__title">{{ title }}</span>
      <span class="agri-chart__hint">图表容器</span>
    </div>
    <div class="agri-chart__body">
      <span class="agri-chart__placeholder">图表容器占位</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-chart {
  display: flex;
  flex-direction: column;
  padding: $space-md;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-card;
}

.agri-chart__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-md;
}

.agri-chart__title {
  font-size: $font-size-base;
  font-weight: 600;
  color: $text-primary;
}

.agri-chart__hint {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.agri-chart__body {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  border: 1px dashed $border-color;
  border-radius: $radius-sm;
  background-image:
    linear-gradient(90deg, rgba(46, 125, 88, 0.06) 1px, transparent 1px),
    linear-gradient(rgba(46, 125, 88, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
}

.agri-chart__placeholder {
  font-size: $font-size-sm;
  color: $text-secondary;
}
</style>
