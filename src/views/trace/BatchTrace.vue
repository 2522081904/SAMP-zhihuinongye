<script setup>
/**
 * P021 溯源批次与二维码生成
 * 职责：维护溯源批次并生成一物一码二维码，供消费者扫码查询。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'TraceBatchPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P021"
      title="溯源批次与二维码生成"
      description="维护溯源批次并生成一物一码二维码，供消费者扫码查询。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供批次列表、二维码批量生成与下载。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
