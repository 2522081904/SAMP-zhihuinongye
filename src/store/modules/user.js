/**
 * 用户状态：登录令牌、用户信息、权限码。
 * 骨架阶段 login / fetchProfile 使用本地 mock，不依赖真实后端；
 * 对接后端时把 mock 分支替换为 api/modules/auth.js 的真实请求即可。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const TOKEN_KEY = 'agri_token'

export const useUserStore = defineStore('user', () => {
  // 令牌持久化在 localStorage，刷新页面不丢登录态
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const profile = ref(null)

  const isLogin = computed(() => Boolean(token.value))
  const userName = computed(() => profile.value?.name || '未登录')
  const permissions = computed(() => profile.value?.permissions || [])

  /**
   * 判断是否拥有某个权限码。
   * 权限集合含通配符 '*' 时一律通过（骨架阶段 mock 用户即全量权限）。
   * 路由级拦截由 router/index.js 的守卫调用；按钮级由 directives/permission.js 调用。
   * @param {string} code 权限码，例如 'iot:control'
   * @returns {boolean} 是否放行
   */
  function hasPerm(code) {
    if (!code) {
      return true
    }
    const owned = permissions.value
    return owned.includes('*') || owned.includes(code)
  }

  function setToken(value) {
    token.value = value || ''
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  /** 登录（mock 成功，返回 true 表示通过） */
  async function login(form) {
    if (!form?.username || !form?.password) {
      return false
    }
    setToken(`mock-token-${Date.now()}`)
    profile.value = {
      id: 1,
      name: form.username,
      roleName: '基地管理员',
      permissions: ['*', 'iot:control', 'farm:plan:edit', 'trace:edit']
    }
    return true
  }

  /** 退出登录，清空令牌与用户信息 */
  function logout() {
    setToken('')
    profile.value = null
  }

  /** 拉取用户信息（mock，返回内置管理员档案） */
  async function fetchProfile() {
    if (!token.value) {
      return null
    }
    if (!profile.value) {
      profile.value = {
        id: 1,
        name: 'admin',
        roleName: '基地管理员',
        permissions: ['*', 'iot:control', 'farm:plan:edit', 'trace:edit']
      }
    }
    return profile.value
  }

  return {
    token,
    profile,
    isLogin,
    userName,
    permissions,
    hasPerm,
    setToken,
    login,
    logout,
    fetchProfile
  }
})
