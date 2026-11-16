<script setup>
/**
 * P029 用户与角色管理
 * 职责：维护平台账号、所属角色与账号启停状态。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'SystemUserListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P029"
      title="用户与角色管理"
      description="维护平台账号、所属角色与账号启停状态。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供账号列表、角色分配与密码重置。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
