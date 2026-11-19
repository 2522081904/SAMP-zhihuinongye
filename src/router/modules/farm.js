/**
 * 农事与农资模块路由
 * 农事计划 / 工单（农事管理）+ 农资档案 / 台账 / 库存 / 采收（农资与采收）
 */
export default [
  {
    path: '/farm/plans',
    name: 'FarmPlanList',
    component: () => import('@/views/farm/PlanList.vue'),
    meta: {
      perm: 'farm:plan:view',
      title: '农事计划管理',
      pageId: 'P015',
      module: '生产农事管理',
      icon: 'Calendar'
    }
  },
  {
    path: '/farm/tasks',
    name: 'FarmTaskList',
    component: () => import('@/views/farm/TaskList.vue'),
    meta: {
      perm: 'farm:task:view',
      title: '农事工单与打卡',
      pageId: 'P016',
      module: '生产农事管理',
      icon: 'List'
    }
  },
  {
    path: '/farm/inputs',
    name: 'FarmInputApply',
    component: () => import('@/views/farm/InputApply.vue'),
    meta: {
      perm: 'farm:input:view',
      title: '农资档案与领用',
      pageId: 'P017',
      module: '生产农事管理',
      icon: 'Box'
    }
  },
  {
    path: '/farm/inputs/ledger',
    name: 'FarmInputLedger',
    component: () => import('@/views/farm/InputLedger.vue'),
    meta: {
      perm: 'farm:ledger:view',
      title: '出库与投入品台账',
      pageId: 'P018',
      module: '生产农事管理',
      icon: 'Notebook'
    }
  },
  {
    path: '/farm/inputs/inventory',
    name: 'FarmInventory',
    component: () => import('@/views/farm/Inventory.vue'),
    meta: {
      perm: 'farm:inventory:view',
      title: '库存与低库存预警',
      pageId: 'P019',
      module: '生产农事管理',
      icon: 'Warning'
    }
  }
]
