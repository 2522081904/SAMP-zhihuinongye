<script setup>
/**
 * P003 设备详情
 * 职责：展示单个设备的型号、通信状态、采集指标与最近上报记录。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'DeviceDetailPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P003"
      title="设备详情"
      description="展示单个设备的型号、通信状态、采集指标与最近上报记录。"
    />
    <div class="agri-card">
      <p class="page-note">后续补充设备基础信息、在线状态时间轴与历史上报曲线。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
