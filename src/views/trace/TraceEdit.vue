<script setup>
/**
 * P022 溯源信息编辑与扫码预览
 * 职责：编辑批次溯源展示内容，并预览消费者扫码看到的页面。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'TraceEditPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P022"
      title="溯源信息编辑与扫码预览"
      description="编辑批次溯源展示内容，并预览消费者扫码看到的页面。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供左编辑右预览的双栏结构与发布操作。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
