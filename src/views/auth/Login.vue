<script setup>
/**
 * P001 登录页
 * 职责：账号密码登录入口，登录成功后写入 token 并跳转工作台。
 * 骨架阶段表单不校验、不发请求，调用 user store 的 mock 登录即可进入系统。
 */
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'LoginPage' })

const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)

const form = reactive({
  username: 'admin',
  password: 'admin123',
  captcha: ''
})

async function handleLogin() {
  loading.value = true
  try {
    await userStore.login({ username: form.username, password: form.password })
    ElMessage.success('登录成功')
    router.push('/iot/env')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-page__panel">
      <AgriPageHeader
        page-id="P001"
        title="登录页"
        description="账号密码登录入口，登录成功后写入 token 并跳转工作台。"
      />
      <el-form class="login-page__form" :model="form" label-width="72px" @submit.prevent>
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="请输入账号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="验证码">
          <el-input v-model="form.captcha" placeholder="骨架阶段不校验验证码" />
        </el-form-item>
        <el-button
          type="primary"
          class="login-page__submit"
          :loading="loading"
          @click="handleLogin"
        >
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: $bg-page;
}

.login-page__panel {
  width: 420px;
  padding: $space-lg;
  background-color: #fff;
  border-radius: $radius-md;
  box-shadow: $shadow-md;
}

.login-page__form {
  margin-top: $space-lg;
}

.login-page__submit {
  width: 100%;
}
</style>
