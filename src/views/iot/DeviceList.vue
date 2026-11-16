<script setup>
/**
 * P005 设备总览
 * 职责：以列表方式查看全部设备的在线状态、所属大棚与最近心跳时间。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'DeviceListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P005"
      title="设备总览"
      description="以列表方式查看全部设备的在线状态、所属大棚与最近心跳时间。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供状态筛选、批量重启与设备台账导出。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
