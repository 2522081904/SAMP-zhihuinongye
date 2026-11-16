/**
 * 认证模块路由
 * /login 为独立页面，不套布局，因此带 meta.layout = 'blank'。
 */
export default [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: {
      title: '登录页',
      pageId: 'P001',
      module: '登录与鉴权',
      layout: 'blank',
      menu: false
    }
  }
]
