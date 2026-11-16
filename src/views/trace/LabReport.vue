<script setup>
/**
 * P023 检测报告与送检管理
 * 职责：登记送检申请，上传农残检测报告并关联到对应批次。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'TraceLabReportPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P023"
      title="检测报告与送检管理"
      description="登记送检申请，上传农残检测报告并关联到对应批次。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供送检单、报告上传与批次关联。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
