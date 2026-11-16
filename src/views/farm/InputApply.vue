<script setup>
/**
 * P017 农资档案与领用申请
 * 职责：维护种子、化肥、农药等农资档案，处理领用申请。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'FarmInputApplyPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P017"
      title="农资档案与领用申请"
      description="维护种子、化肥、农药等农资档案，处理领用申请。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供农资档案维护与领用单审批。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
