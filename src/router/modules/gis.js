/**
 * GIS 模块路由（一张图总览与地块绘制、空间统计与图层管理）
 */
export default [
  {
    path: '/gis/map',
    name: 'GisMapView',
    component: () => import('@/views/gis/MapView.vue'),
    meta: { title: 'GIS 一张图', pageId: 'P014', module: 'GIS地理信息', icon: 'MapLocation' }
  },
  {
    path: '/gis/stats',
    name: 'GisMapStats',
    component: () => import('@/views/gis/MapStats.vue'),
    meta: { title: '空间统计与图层', pageId: 'P024', module: 'GIS地理信息', icon: 'Histogram' }
  }
]
