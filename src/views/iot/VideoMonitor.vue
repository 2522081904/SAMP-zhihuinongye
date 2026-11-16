<script setup>
/**
 * P013 视频监控
 * 职责：接入大棚摄像头画面，支持多路预览与抓拍留证。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'VideoMonitorPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P013"
      title="视频监控"
      description="接入大棚摄像头画面，支持多路预览与抓拍留证。"
    />
    <div class="agri-card">
      <p class="page-note">后续接入流媒体播放器与设备通道树。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
