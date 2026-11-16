<script setup>
/**
 * P009 控制日志
 * 职责：记录设备控制指令的下发人、下发时间与执行结果，便于追溯。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'ControlLogPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P009"
      title="控制日志"
      description="记录设备控制指令的下发人、下发时间与执行结果，便于追溯。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供按设备与时间范围检索的控制日志表格。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
