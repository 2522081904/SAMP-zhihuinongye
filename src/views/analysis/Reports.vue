<script setup>
/**
 * P011 报表中心
 * 职责：生成并下载生产、投入品、采收等周期性报表。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AnalysisReportsPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P011"
      title="报表中心"
      description="生成并下载生产、投入品、采收等周期性报表。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供报表模板选择、时间区间与导出任务列表。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
