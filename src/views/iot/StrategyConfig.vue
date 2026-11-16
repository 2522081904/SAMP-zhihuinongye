<script setup>
/**
 * P008 策略联动配置
 * 职责：配置「环境指标触发条件 → 执行动作」的自动化联动策略。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'StrategyConfigPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P008"
      title="策略联动配置"
      description="配置「环境指标触发条件 → 执行动作」的自动化联动策略。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供条件组编辑、执行动作选择与策略启停。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
