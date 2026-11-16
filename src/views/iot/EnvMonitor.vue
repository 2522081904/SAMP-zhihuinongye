<script setup>
/**
 * P002 环境数据监测
 * 职责：实时展示大棚空气温湿度、土壤温湿度、光照与二氧化碳等环境指标。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'EnvMonitorPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P002"
      title="环境数据监测"
      description="实时展示大棚空气温湿度、土壤温湿度、光照与二氧化碳等环境指标。"
    />
    <div class="agri-card">
      <p class="page-note">后续接入实时数据推送，按大棚维度分区展示指标卡与仪表盘。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
