<script setup>
/**
 * P027 订单管理
 * 职责：管理线上订单的发货、物流与售后状态。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'CommerceOrderListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P027"
      title="订单管理"
      description="管理线上订单的发货、物流与售后状态。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供订单列表、状态流转与发货登记。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
