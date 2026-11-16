/**
 * 移动端路由（工作台、农事打卡、扫码溯源）
 * 统一挂在 MobileLayout 下，meta.menu = false 表示不进入 PC 侧边菜单。
 */
export default [
  {
    path: '/m/home',
    name: 'MobileHome',
    component: () => import('@/views-m/MHome.vue'),
    meta: { title: '移动端工作台', pageId: 'M001', module: '农户移动端', menu: false }
  },
  {
    path: '/m/checkin',
    name: 'MobileCheckin',
    component: () => import('@/views-m/MCheckin.vue'),
    meta: { title: '农事打卡上传', pageId: 'M002', module: '农户移动端', menu: false }
  },
  {
    path: '/trace/scan',
    name: 'MobileScan',
    component: () => import('@/views-m/MScan.vue'),
    meta: { title: '扫码溯源查询', pageId: 'M003', module: '质量安全溯源', menu: false }
  }
]
