/**
 * 路由总装
 * - history 模式（createWebHistory）
 * - PC 页面挂在 DefaultLayout 下；/m/* 与扫码页 /trace/scan 挂在 MobileLayout 下；/login 独立无布局
 * - meta 统一携带 { title, pageId, module }，供面包屑、侧边菜单、document.title 使用
 * - 侧边菜单由本文件的 PC 子路由自动生成（见 router/menu.js），菜单与路由只有一份数据源
 */
import { createRouter, createWebHistory } from 'vue-router'

import { useUserStore } from '@/store/modules/user'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import MobileLayout from '@/layouts/MobileLayout.vue'

import authRoutes from './modules/auth'
import iotRoutes from './modules/iot'
import alertRoutes from './modules/alert'
import analysisRoutes from './modules/analysis'
import gisRoutes from './modules/gis'
import farmRoutes from './modules/farm'
import traceRoutes from './modules/trace'
import commerceRoutes from './modules/commerce'
import systemRoutes from './modules/system'
import mobileRoutes from './modules/mobile'

// PC 子路由的顺序即侧边菜单的模块顺序
export const pcRoutes = [
  ...iotRoutes,
  ...alertRoutes,
  ...analysisRoutes,
  ...gisRoutes,
  ...farmRoutes,
  ...traceRoutes,
  ...commerceRoutes,
  ...systemRoutes
]

// 移动端底部 tab 路由：把 /m/xxx 转成 /m 下的相对子路由
const mobileTabRoutes = mobileRoutes
  .filter((route) => route.path.startsWith('/m/'))
  .map((route) => ({ ...route, path: route.path.replace('/m/', '') }))

const routes = [
  // 登录页独立布局
  authRoutes[0],
  {
    // PC 端布局路由
    path: '/',
    component: DefaultLayout,
    redirect: '/iot/env',
    children: pcRoutes
  },
  {
    // 移动端布局：底部 tab
    path: '/m',
    component: MobileLayout,
    redirect: '/m/home',
    children: mobileTabRoutes
  },
  {
    // 扫码溯源页 M003 复用移动端布局
    path: '/trace/scan',
    component: MobileLayout,
    children: [
      {
        path: '',
        name: 'MobileScan',
        component: () => import('@/views-m/MScan.vue'),
        meta: { title: '扫码溯源查询', pageId: 'M003', module: '质量安全溯源' }
      }
    ]
  },
  {
    // 403 无权访问：由权限守卫跳转，不进菜单
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { title: '无权访问', pageId: '403', module: '系统后台管理', menu: false }
  },
  {
    // 404 兜底
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在', pageId: '404', module: '系统' }
  }
]

// 全局前置守卫：维护浏览器标题 → 登录态拦截 → 路由级权限拦截
// 业务页（未登录）会被拦到 /login 并带上 redirect，登录成功后再跳回原地址；
// 给敏感路由加 meta.perm（例如 meta: { perm: 'system:user:list' }）即自动生效。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 允许未登录访问的路径：登录页、403 无权页、消费者扫码页（按需求就该匿名可看）
// 404 兜底路由是通配符，没法按路径列举，改用路由名判断
const PUBLIC_PATHS = ['/login', '/403', '/trace/scan']

/**
 * 判断目标路由是否允许匿名访问。
 * @param {import('vue-router').RouteLocationNormalized} to 目标路由
 * @returns {boolean} true 表示无需登录
 */
function isPublicRoute(to) {
  return PUBLIC_PATHS.includes(to.path) || to.name === 'NotFound'
}

router.beforeEach((to) => {
  const title = to.meta?.title
  document.title = title ? `${title} - 智慧农业综合管理平台` : '智慧农业综合管理平台'

  const userStore = useUserStore()

  // 第一关：登录态。已登录不必再停留在登录页；未登录访问业务页一律拦到登录页并记住来路
  if (userStore.isLogin && to.path === '/login') {
    return { path: '/iot/env' }
  }
  if (!userStore.isLogin && !isPublicRoute(to)) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 第二关：路由级权限。登录态通过后才判断，避免未登录用户被误导到 403
  const perm = to.meta?.perm
  if (perm && !userStore.hasPerm(perm)) {
    return { path: '/403', query: { from: to.fullPath } }
  }
  return true
})

export default router
