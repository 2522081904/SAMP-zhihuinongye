<script setup>
/**
 * 403 无权访问页
 * 路由级权限守卫（router/index.js 的 beforeEach）拦下无权限地址后跳转到本页。
 * 该页属于错误页，不计入 33 个业务页面。
 */
import { useRoute, useRouter } from 'vue-router'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'ForbiddenPage' })

const route = useRoute()
const router = useRouter()

// 守卫跳转时会带上被拦截的地址，便于排查
const from = route.query.from

function backToWorkbench() {
  router.push('/iot/env')
}
</script>

<template>
  <div class="page-container">
    <AgriPageHeader
      page-id="403"
      title="无权访问"
      description="当前账号没有该页面的访问权限，请联系管理员分配角色后再试。"
    />
    <div class="agri-card">
      <p class="page-note">
        被拦截的地址：{{ from || '未记录' }}。若确认权限已开通，请退出后重新登录刷新权限缓存。
      </p>
      <AgriEmpty description="无访问权限" />
      <div class="forbidden-actions">
        <el-button type="primary" @click="backToWorkbench">返回工作台</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.forbidden-actions {
  display: flex;
  justify-content: center;
  padding-bottom: 8px;
}
</style>
