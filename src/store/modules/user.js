/**
 * 用户状态：登录令牌、用户档案（姓名 / 角色 / 权限码）。
 * 登录走 A01，档案走 A02：登录成功后、以及刷新页面时本地已有 token 的情况，
 * 都要补拉一次 /auth/me，否则顶栏、权限指令、路由守卫只能拿到空档案，
 * 表现为「明明登录了，顶栏一直显示未登录」。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchCurrentUser, login as loginApi } from '@/api'

const TOKEN_KEY = 'agri_token'

export const useUserStore = defineStore('user', () => {
  // 令牌持久化在 localStorage，刷新页面不丢登录态
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  // A02 档案：{ id, username, name, role, roleCode, roleName, permissions, plotIds }
  const profile = ref(null)
  // A02 返回的菜单树，预留给动态菜单（当前路由表是静态注册的）
  const menus = ref([])
  // 档案请求进行中：顶栏据此显示「加载中…」，避免先闪一下「未登录」
  const profileLoading = ref(false)
  // 并发合流：布局与页面可能同时触发 fetchProfile，共用同一个在途 Promise
  let profileTask = null

  const isLogin = computed(() => Boolean(token.value))
  const userInfo = computed(() => profile.value)
  const userName = computed(() => {
    if (!token.value) {
      return '未登录'
    }
    if (!profile.value) {
      return profileLoading.value ? '加载中…' : '未登录'
    }
    return profile.value.name || profile.value.username || '未登录'
  })
  const roleName = computed(() => profile.value?.roleName || '')
  // 顶栏展示口径：「姓名 · 角色名」，未登录只有「未登录」四个字
  const userLabel = computed(() =>
    roleName.value && profile.value ? `${userName.value} · ${roleName.value}` : userName.value
  )
  const permissions = computed(() => profile.value?.permissions || [])

  /**
   * 判断是否拥有某个权限码。
   * 权限集合含通配符 '*' 时一律通过（管理员账号）。
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

  /**
   * A01 / A02 返回的用户结构字段不完全一致（perms 与 permissions 并存），
   * 这里统一归一化成页面只认的一套字段。
   * @param {Object|null} raw 接口返回的用户对象
   * @returns {Object|null} 归一化后的档案
   */
  function normalizeProfile(raw) {
    if (!raw) {
      return null
    }
    const owned = raw.perms || raw.permissions || []
    return {
      id: raw.id ?? 0,
      username: raw.username || '',
      name: raw.name || raw.username || '',
      role: raw.role || '',
      roleCode: raw.roleCode || '',
      roleName: raw.roleName || '',
      permissions: Array.isArray(owned) ? owned : [],
      plotIds: Array.isArray(raw.plotIds) ? raw.plotIds : [],
      lastLoginAt: raw.lastLoginAt || ''
    }
  }

  /**
   * 登录：调 A01 换取真实 token，并用返回的 userInfo 先填一版档案。
   * 权限完整档案由调用方随后再调 fetchProfile()（A02）补全。
   * @param {{username:string,password:string}} form 登录表单
   * @returns {Promise<boolean>} 是否登录成功
   */
  async function login(form) {
    if (!form?.username || !form?.password) {
      return false
    }
    const data = await loginApi({ username: form.username, password: form.password })
    const nextToken = data?.token || ''
    if (!nextToken) {
      throw new Error('登录失败：接口未返回令牌')
    }
    setToken(nextToken)
    profile.value = normalizeProfile(data?.userInfo)
    return true
  }

  /**
   * 拉取当前用户档案（A02 GET /auth/me）。
   * @param {{force?:boolean}} [options] force=true 时忽略已有档案强制重拉
   * @returns {Promise<Object|null>} 档案；未登录或失败时返回 null
   */
  async function fetchProfile(options = {}) {
    if (!token.value) {
      profile.value = null
      return null
    }
    if (!options.force && profile.value) {
      return profile.value
    }
    if (profileTask) {
      return profileTask
    }
    profileLoading.value = true
    profileTask = (async () => {
      try {
        const data = await fetchCurrentUser()
        // A02 结构：{ user, menus, roles, permissions }，档案以 user 为准
        profile.value = normalizeProfile(data?.user)
        menus.value = Array.isArray(data?.menus) ? data.menus : []
        return profile.value
      } catch {
        // 40101 已由 request.js 拦截器清 token 并整页跳登录；
        // 其他错误只做降级（保留旧档案），不阻断当前页面渲染
        return null
      } finally {
        profileLoading.value = false
        profileTask = null
      }
    })()
    return profileTask
  }

  /** 退出登录：清令牌、清档案、清菜单，跳转由调用方负责 */
  function logout() {
    setToken('')
    profile.value = null
    menus.value = []
    profileTask = null
  }

  return {
    token,
    profile,
    userInfo,
    menus,
    profileLoading,
    isLogin,
    userName,
    roleName,
    userLabel,
    permissions,
    hasPerm,
    setToken,
    login,
    logout,
    fetchProfile
  }
})
