<script setup>
/**
 * 404 兜底页
 * 路由未匹配时展示，提供返回首页的入口。
 */
import { useRouter } from 'vue-router'
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'NotFoundPage' })

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <AgriEmpty description="页面不存在，请检查访问地址">
      <el-button type="primary" @click="router.replace('/iot/env')">返回首页</el-button>
    </AgriEmpty>
  </div>
</template>

<style scoped lang="scss">
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: $space-lg;
  background-color: #fff;
}
</style>
