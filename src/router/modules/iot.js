/**
 * 物联网模块路由（环境监测、设备管理、远程控制、视频监控）
 * meta 字段统一为 { title, pageId, module, icon }，侧边菜单由 router 配置自动生成。
 */
export default [
  {
    path: '/iot/env',
    name: 'IotEnvMonitor',
    component: () => import('@/views/iot/EnvMonitor.vue'),
    meta: { title: '环境数据监测', pageId: 'P002', module: '物联网感知监测', icon: 'Odometer' }
  },
  {
    path: '/iot/history',
    name: 'IotHistoryChart',
    component: () => import('@/views/iot/HistoryChart.vue'),
    meta: { title: '历史数据与趋势', pageId: 'P004', module: '物联网感知监测', icon: 'TrendCharts' }
  },
  {
    path: '/iot/devices',
    name: 'IotDeviceList',
    component: () => import('@/views/iot/DeviceList.vue'),
    meta: { title: '设备总览', pageId: 'P005', module: '物联网感知监测', icon: 'Cpu' }
  },
  {
    path: '/iot/devices/detail',
    name: 'IotDeviceDetail',
    component: () => import('@/views/iot/DeviceDetail.vue'),
    meta: { title: '设备详情', pageId: 'P003', module: '物联网感知监测', icon: 'Document' }
  },
  {
    path: '/iot/patrol',
    name: 'IotDevicePatrol',
    component: () => import('@/views/iot/DevicePatrol.vue'),
    meta: { title: '设备巡检与离线排查', pageId: 'P006', module: '物联网感知监测', icon: 'Search' }
  },
  {
    path: '/iot/control',
    name: 'IotControlPanel',
    component: () => import('@/views/iot/ControlPanel.vue'),
    meta: { title: '远程控制', pageId: 'P007', module: '远程智能控制', icon: 'Switch' }
  },
  {
    path: '/iot/strategy',
    name: 'IotStrategyConfig',
    component: () => import('@/views/iot/StrategyConfig.vue'),
    meta: { title: '策略联动配置', pageId: 'P008', module: '远程智能控制', icon: 'SetUp' }
  },
  {
    path: '/iot/control/log',
    name: 'IotControlLog',
    component: () => import('@/views/iot/ControlLog.vue'),
    meta: { title: '控制日志', pageId: 'P009', module: '远程智能控制', icon: 'Tickets' }
  },
  {
    path: '/iot/video',
    name: 'IotVideoMonitor',
    component: () => import('@/views/iot/VideoMonitor.vue'),
    meta: { title: '视频监控', pageId: 'P013', module: '物联网感知监测', icon: 'VideoCamera' }
  }
]
