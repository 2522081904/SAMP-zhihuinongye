<script setup>
/**
 * P020 采收批次登记
 * 职责：按地块登记采收批次、采收日期与数量，生成溯源批次基础数据。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'FarmHarvestRegisterPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P020"
      title="采收批次登记"
      description="按地块登记采收批次、采收日期与数量，生成溯源批次基础数据。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供批次登记表单与批次列表。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
