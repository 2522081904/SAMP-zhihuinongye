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
  }
]
