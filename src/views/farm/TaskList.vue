<script setup>
/**
 * P016 农事工单与打卡审核
 * 职责：查看农事工单执行情况，审核移动端提交的农事打卡记录。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'FarmTaskListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P016"
      title="农事工单与打卡审核"
      description="查看农事工单执行情况，审核移动端提交的农事打卡记录。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供工单状态流转、打卡照片与审核意见。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
