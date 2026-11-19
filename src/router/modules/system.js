/**
 * 系统管理模块路由（用户与角色、权限配置与接口对接）
 */
export default [
  {
    path: '/system/users',
    name: 'SystemUserList',
    component: () => import('@/views/system/UserList.vue'),
    meta: {
      perm: 'system:user:view',
      title: '用户与角色管理',
      pageId: 'P029',
      module: '系统后台管理',
      icon: 'User'
    }
  },
  {
    path: '/system/perm',
    name: 'SystemPermConfig',
    component: () => import('@/views/system/PermConfig.vue'),
    meta: {
      perm: 'system:perm:view',
      title: '权限配置与接口对接',
      pageId: 'P030',
      module: '系统后台管理',
      icon: 'Lock'
    }
  },
  // 个人信息自助页：所有登录用户都可访问自己的资料，因此不设 meta.perm。
  // 必须放在数组最后：router/index.js 的 firstAllowedPath() 取「第一个无 perm 或有权」的路由
  // 作为登录后落点，本页若排在前面会变成所有人登录后的首页。
  // menu: false 让 router/menu.js 跳过它，不进侧边栏。
  {
    path: '/profile',
    name: 'UserProfile',
    component: () => import('@/views/Profile.vue'),
    meta: {
      title: '个人信息',
      pageId: '',
      module: '系统后台管理',
      menu: false
    }
  }
]
