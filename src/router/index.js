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

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 全局前置守卫：维护浏览器标题 + 路由级权限拦截
// 给敏感路由加 meta.perm（例如 meta: { perm: 'system:user:list' }）即自动生效；
// 骨架阶段没有路由声明 meta.perm，因此默认全部放行。
router.beforeEach((to) => {
  const title = to.meta?.title
  document.title = title ? `${title} - 智慧农业综合管理平台` : '智慧农业综合管理平台'

  const perm = to.meta?.perm
  if (perm) {
    const userStore = useUserStore()
    if (!userStore.hasPerm(perm)) {
      return { path: '/403', query: { from: to.fullPath } }
    }
  }
  return true
})

export default router
