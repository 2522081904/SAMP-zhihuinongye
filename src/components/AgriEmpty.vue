<script setup>
/**
 * 空状态占位组件
 * 骨架阶段页面统一用它显示空态提示，接入真实数据后改为图标 + 引导文案。
 */
defineOptions({ name: 'AgriEmpty' })

defineProps({
  // 提示文案
  description: {
    type: String,
    default: '暂无数据'
  },
  // 占位高度
  height: {
    type: String,
    default: '220px'
  }
})
</script>

<template>
  <div class="agri-empty" :style="{ minHeight: height }">
    <el-empty :description="description">
      <slot />
    </el-empty>
  </div>
</template>

<style scoped lang="scss">
.agri-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background-color: $bg-card;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}
</style>
