<script setup>
/**
 * P025 告警列表
 * 职责：汇总环境越限、设备离线等告警，按级别与时间排序。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AlertListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P025"
      title="告警列表"
      description="汇总环境越限、设备离线等告警，按级别与时间排序。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供告警筛选、批量确认与详情查看。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
