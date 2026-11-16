<script setup>
/**
 * M003 扫码溯源查询
 * 职责：消费者扫码查看农产品溯源信息：产地、农事记录与检测报告。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'MobileScanPage' })
</script>

<template>
  <div class="m-page">
    <AgriPageHeader
      page-id="M003"
      title="扫码溯源查询"
      description="消费者扫码查看农产品溯源信息：产地、农事记录与检测报告。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供扫码入口与溯源信息展示。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
