<script setup>
/**
 * P010 数据分析总览
 * 职责：汇总产量、投入品用量、告警次数等关键指标，形成经营看板。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AnalysisOverviewPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P010"
      title="数据分析总览"
      description="汇总产量、投入品用量、告警次数等关键指标，形成经营看板。"
    />
    <div class="agri-card">
      <p class="page-note">后续补充指标卡、趋势图与同比环比数据。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
