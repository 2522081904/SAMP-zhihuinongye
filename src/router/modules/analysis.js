/**
 * 数据分析模块路由（总览、报表中心、长势与病虫害识别）
 */
export default [
  {
    path: '/analysis/overview',
    name: 'AnalysisOverview',
    component: () => import('@/views/analysis/Overview.vue'),
    meta: { title: '数据分析总览', pageId: 'P010', module: '数据中心与AI分析', icon: 'PieChart' }
  },
  {
    path: '/reports',
    name: 'AnalysisReports',
    component: () => import('@/views/analysis/Reports.vue'),
    meta: { title: '报表中心', pageId: 'P011', module: '数据中心与AI分析', icon: 'Files' }
  },
  {
    path: '/analysis/ai',
    name: 'AnalysisAiInsight',
    component: () => import('@/views/analysis/AiInsight.vue'),
    meta: {
      title: '长势与病虫害识别',
      pageId: 'P012',
      module: '数据中心与AI分析',
      icon: 'MagicStick'
    }
  }
]
