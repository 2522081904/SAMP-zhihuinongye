<script setup>
/**
 * P004 历史数据与趋势分析
 * 职责：按时间段查询环境历史数据并绘制趋势曲线，支持多指标对比。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'HistoryChartPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P004"
      title="历史数据与趋势分析"
      description="按时间段查询环境历史数据并绘制趋势曲线，支持多指标对比。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供时间范围筛选、指标多选与曲线导出。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
