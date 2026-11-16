<script setup>
/**
 * P006 设备巡检与离线排查
 * 职责：记录设备巡检任务，定位长时间离线设备并跟踪排查结论。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'DevicePatrolPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P006"
      title="设备巡检与离线排查"
      description="记录设备巡检任务，定位长时间离线设备并跟踪排查结论。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供巡检计划、离线时长排序与处理结果回填。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
