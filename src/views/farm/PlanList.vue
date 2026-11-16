<script setup>
/**
 * P015 农事计划管理
 * 职责：按地块与作物编排农事计划，安排播种、施肥、采摘等节点。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'FarmPlanListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P015"
      title="农事计划管理"
      description="按地块与作物编排农事计划，安排播种、施肥、采摘等节点。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供计划列表、甘特视图与计划下发。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
