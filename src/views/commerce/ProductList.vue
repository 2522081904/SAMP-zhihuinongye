<script setup>
/**
 * P028 商品与客户档案
 * 职责：维护上架商品信息与采购客户档案。
 * 骨架阶段只保留页面结构与职责说明，业务逻辑在对应模块中实现。
 */
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'CommerceProductListPage' })
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="P028"
      title="商品与客户档案"
      description="维护上架商品信息与采购客户档案。"
    />
    <div class="agri-card">
      <p class="page-note">后续提供商品上下架与客户档案维护。</p>
      <AgriEmpty description="待实现" />
    </div>
  </div>
</template>
