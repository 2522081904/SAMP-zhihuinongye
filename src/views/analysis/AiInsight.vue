<script setup>
/**
 * P012 长势与病虫害识别
 * 职责：上传作物照片识别长势与病虫害类型，给出处置建议。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AiInsightPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P012"
      title="长势与病虫害识别"
      description="上传作物照片识别长势与病虫害类型，给出处置建议。"
    />
    <div class="agri-card">
      <p class="page-note">后续接入识别接口，展示识别结果、置信度与历史记录。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
