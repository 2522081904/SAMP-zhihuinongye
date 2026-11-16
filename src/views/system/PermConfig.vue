<script setup>
/**
 * P030 权限配置与接口对接
 * 职责：配置角色权限项，维护第三方接口的对接参数。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'SystemPermConfigPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P030"
      title="权限配置与接口对接"
      description="配置角色权限项，维护第三方接口的对接参数。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供权限树勾选与接口地址、密钥配置。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
