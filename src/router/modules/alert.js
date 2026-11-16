/**
 * 告警模块路由（告警列表、告警处置与统计分析）
 */
export default [
  {
    path: '/iot/alerts',
    name: 'AlertList',
    component: () => import('@/views/alert/AlertList.vue'),
    meta: { title: '告警列表', pageId: 'P025', module: '告警消息中心', icon: 'Bell' }
  },
  {
    path: '/iot/alerts/handle',
    name: 'AlertHandle',
    component: () => import('@/views/alert/AlertHandle.vue'),
    meta: { title: '告警处置与统计', pageId: 'P026', module: '告警消息中心', icon: 'DataAnalysis' }
  }
]
