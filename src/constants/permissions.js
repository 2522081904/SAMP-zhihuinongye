/**
 * 菜单页面级权限码（唯一数据源）
 * 用途：
 *   - router/modules/*.js 的 meta.perm：页面级路由拦截依据；
 *   - router/menu.js：侧边菜单按权限过滤；
 *   - mock/handlers/auth.js：A02 按当前用户权限过滤菜单树（后端行为模拟）；
 *   - views/system/PermConfig.vue、views/system/UserList.vue：权限树节点编码。
 * 键为工程路由 path，值为该页面的菜单级权限码。
 * A02 只返回菜单结构、不返回编码，编码为前端口径常量（接入真实权限中心后应改为后端下发）。
 */
export const MENU_PERMISSION_CODES = {
  '/iot/env': 'iot:env:view',
  '/iot/history': 'iot:history:view',
  '/iot/devices': 'iot:device:list',
  '/iot/devices/detail': 'iot:device:detail',
  '/iot/patrol': 'iot:patrol:view',
  '/iot/video': 'iot:video:view',
  '/iot/control': 'iot:control',
  '/iot/strategy': 'iot:strategy:view',
  '/iot/control/log': 'ctl:log:view',
  '/analysis/overview': 'analysis:overview:view',
  '/reports': 'report:view',
  '/analysis/ai': 'ai:view',
  '/gis/map': 'gis:map:view',
  '/gis/stats': 'gis:stats:view',
  '/farm/plans': 'farm:plan:view',
  '/farm/tasks': 'farm:task:view',
  '/farm/inputs': 'farm:input:view',
  '/farm/inputs/ledger': 'farm:ledger:view',
  '/farm/inputs/inventory': 'farm:inventory:view',
  '/farm/harvest': 'farm:harvest:view',
  '/trace/batches': 'trace:batch:view',
  '/trace/edit': 'trace:edit',
  '/trace/lab': 'trace:lab:view',
  '/iot/alerts': 'alarm:view',
  '/iot/alerts/handle': 'alarm:handle',
  '/commerce/orders': 'trade:order:view',
  '/commerce/products': 'trade:goods:view',
  '/system/users': 'system:user:view',
  '/system/perm': 'system:perm:view'
}

/**
 * 按钮级权限码：A02 不返回按钮节点，按模块维护一份前端常量（P029/P030 同口径）。
 * 键为菜单模块名（meta.module），值是该模块下的按钮权限列表。
 */
export const MODULE_BUTTONS = {
  物联网感知监测: [
    { code: 'iot:device:edit', name: '设备编辑' },
    { code: 'iot:device:export', name: '设备导出' },
    { code: 'iot:video:control', name: '云台控制' }
  ],
  远程智能控制: [
    { code: 'iot:control:execute', name: '指令下发' },
    { code: 'iot:strategy:edit', name: '策略编辑' }
  ],
  数据中心与AI分析: [
    { code: 'report:export', name: '报表导出' },
    { code: 'ai:diagnose', name: '发起诊断' }
  ],
  GIS地理信息: [
    { code: 'gis:plot:edit', name: '边界编辑' },
    { code: 'gis:export', name: '图层导出' }
  ],
  生产农事管理: [
    { code: 'farm:plan:create', name: '计划创建' },
    { code: 'farm:record:write', name: '农事记录' },
    { code: 'harvest:write', name: '采收登记' }
  ],
  质量安全溯源: [
    { code: 'trace:write', name: '溯源编辑' },
    { code: 'trace:code:generate', name: '溯源码生成' },
    { code: 'inspection:write', name: '检测报告录入' }
  ],
  告警消息中心: [
    { code: 'alarm:handle', name: '告警处置' },
    { code: 'alarm:export', name: '告警导出' }
  ],
  产销对接与订单: [
    { code: 'trade:order:create', name: '订单创建' },
    { code: 'trade:order:ship', name: '订单发货' }
  ],
  系统后台管理: [
    { code: 'system:user:create', name: '新增用户' },
    { code: 'system:user:reset', name: '重置密码' },
    { code: 'system:perm:save', name: '保存权限' }
  ]
}
