<script setup>
/**
 * M001 移动端工作台
 * 职责：面向基地作业人员的移动端首页，聚合今日工单、告警与快捷入口。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'MobileHomePage' })
</script>

<template>
  <div class="m-page">
    <AgriPageHeader
      page-id="M001"
      title="移动端工作台"
      description="面向基地作业人员的移动端首页，聚合今日工单、告警与快捷入口。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供今日工单卡片、告警提醒与常用功能入口。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
