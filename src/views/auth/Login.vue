<script setup>
/**
 * P001 登录页
 * 职责：账号密码登录入口，登录成功后写入 token 并跳转工作台。
 * 演示环境表单不校验、不发请求，调用 user store 的 mock 登录即可进入系统。
 * 若由路由守卫拦下来（?redirect=/iot/env），登录成功后跳回原地址。
 */
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'LoginPage' })

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)

const form = reactive({
  username: 'admin',
  password: 'admin123',
  captcha: ''
})

/**
 * 解析登录后要跳回的目标地址。
 * 只接受站内路径（以单个 / 开头），避免 redirect 参数被用来跳到外部站点。
 * @returns {string} 站内路径，缺省为工作台
 */
function resolveRedirect() {
  const redirect = route.query.redirect
  const target = typeof redirect === 'string' ? redirect : ''
  return target.startsWith('/') && !target.startsWith('//') ? target : '/iot/env'
}

async function handleLogin() {
  if (loading.value) {
    return
  }
  loading.value = true
  try {
    await userStore.login({ username: form.username, password: form.password })
    // 登录成功后立刻补拉 A02 档案（姓名 / 角色 / 权限码），
    // 否则顶栏只能显示兜底文案，按钮级权限也拿不到真实权限集合
    await userStore.fetchProfile({ force: true })
    ElMessage.success('登录成功')
    // router 的编程式跳转会自动带上部署基路径（GitHub Pages 子路径场景）
    router.replace(resolveRedirect())
  } catch {
    // 失败提示由 request.js 拦截器统一弹出（如 40102 账号或密码错误），这里不重复提示
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
          <el-input v-model="form.captcha" placeholder="演示环境不校验验证码" />
        </el-form-item>
        <el-button
          type="primary"
          class="login-page__submit"
          :loading="loading"
          @click="handleLogin"
        >
          登录
        </el-button>
        <p class="login-page__tip">演示环境：任意账号密码可登录，数据为本地模拟。</p>
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

// 演示环境说明：明确这里是本地 mock 登录，不是真实服务端认证
.login-page__tip {
  margin-top: $space-md;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
  text-align: center;
}
</style>
