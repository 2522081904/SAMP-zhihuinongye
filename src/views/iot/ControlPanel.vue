<script setup>
/**
 * P007 远程控制
 * 职责：对卷帘、风机、水肥一体机等执行器下发远程控制指令。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'ControlPanelPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P007"
      title="远程控制"
      description="对卷帘、风机、水肥一体机等执行器下发远程控制指令。"
    />
    <div class="agri-card">
      <p class="page-note">后续补充设备选择、指令确认与操作结果回执。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
