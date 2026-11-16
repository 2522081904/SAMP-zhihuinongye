<script setup>
/**
 * 页面通用标题栏
 * 用法：<AgriPageHeader page-id="P002" title="环境数据监测页" description="..." />
 * 左侧展示「页面编号 + 页面名称」，右侧通过 #extra 插槽放操作按钮。
 */
defineOptions({ name: 'AgriPageHeader' })

defineProps({
  // 页面编号，例如 P002 / M001
  pageId: {
    type: String,
    default: ''
  },
  // 页面名称
  title: {
    type: String,
    required: true
  },
  // 页面职责说明（一句话）
  description: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <div class="agri-page-header">
    <div class="agri-page-header__main">
      <div class="agri-page-header__title-line">
        <el-tag
          v-if="pageId"
          class="agri-page-header__badge"
          type="success"
          effect="plain"
          size="small"
        >
          {{ pageId }}
        </el-tag>
        <h2 class="agri-page-header__title">{{ title }}</h2>
      </div>
      <p v-if="description" class="agri-page-header__desc">{{ description }}</p>
    </div>
    <div class="agri-page-header__extra">
      <slot name="extra" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-md;
  padding: 16px;
  margin-bottom: 16px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-card;
}

.agri-page-header__title-line {
  display: flex;
  align-items: center;
  gap: $space-sm;
}

.agri-page-header__badge {
  font-family: Consolas, Monaco, monospace;
}

.agri-page-header__title {
  font-size: $font-size-lg;
  font-weight: 600;
  color: $text-primary;
}

.agri-page-header__desc {
  margin-top: $space-sm;
  font-size: $font-size-sm;
  color: $text-secondary;
  line-height: 1.6;
}

.agri-page-header__extra {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .agri-page-header {
    flex-direction: column;
  }
}
</style>
