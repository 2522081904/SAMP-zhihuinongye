<script setup>
/**
 * P014 GIS 地图总览与地块绘制
 * 职责：在一张图上查看基地、地块边界与设备点位，并支持绘制地块。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'GisMapViewPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P014"
      title="GIS 地图总览与地块绘制"
      description="在一张图上查看基地、地块边界与设备点位，并支持绘制地块。"
    />
    <div class="agri-card">
      <p class="page-note">后续接入地图底图与绘制工具，保存地块坐标。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
