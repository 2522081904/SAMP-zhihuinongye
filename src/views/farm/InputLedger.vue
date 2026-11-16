<script setup>
/**
 * P018 农资出库与投入品台账
 * 职责：登记农资出库记录，形成可追溯的投入品使用台账。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'FarmInputLedgerPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P018"
      title="农资出库与投入品台账"
      description="登记农资出库记录，形成可追溯的投入品使用台账。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供出库登记表与台账查询导出。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
