<script setup>
/**
 * M002 农事打卡上传
 * 职责：移动端提交农事打卡：选择工单、填写作业量并上传现场照片。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'MobileCheckinPage' })
</script>

<template>
  <div class="m-page">
    <AgriPageHeader
      page-id="M002"
      title="农事打卡上传"
      description="移动端提交农事打卡：选择工单、填写作业量并上传现场照片。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供拍照上传、定位与打卡提交。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
