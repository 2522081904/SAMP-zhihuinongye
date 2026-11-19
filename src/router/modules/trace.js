/**
 * 采收与溯源模块路由（采收批次、溯源批次与二维码、溯源编辑、检测报告）
 */
export default [
  {
    path: '/farm/harvest',
    name: 'FarmHarvestRegister',
    component: () => import('@/views/farm/HarvestRegister.vue'),
    meta: {
      perm: 'farm:harvest:view',
      title: '采收批次登记',
      pageId: 'P020',
      module: '生产农事管理',
      icon: 'Grape'
    }
  },
  {
    path: '/trace/batches',
    name: 'TraceBatch',
    component: () => import('@/views/trace/BatchTrace.vue'),
    meta: {
      perm: 'trace:batch:view',
      title: '溯源批次与二维码',
      pageId: 'P021',
      module: '质量安全溯源',
      icon: 'Postcard'
    }
  },
  {
    path: '/trace/edit',
    name: 'TraceEdit',
    component: () => import('@/views/trace/TraceEdit.vue'),
    meta: {
      perm: 'trace:edit',
      title: '溯源信息编辑与预览',
      pageId: 'P022',
      module: '质量安全溯源',
      icon: 'EditPen'
    }
  },
  {
    path: '/trace/lab',
    name: 'TraceLabReport',
    component: () => import('@/views/trace/LabReport.vue'),
    meta: {
      perm: 'trace:lab:view',
      title: '检测报告与送检',
      pageId: 'P023',
      module: '质量安全溯源',
      icon: 'DocumentChecked'
    }
  }
]
