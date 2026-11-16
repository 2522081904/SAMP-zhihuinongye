/**
 * 侧边菜单生成
 * 从 PC 子路由按 meta.module 聚合，保证「菜单项 ↔ 路由」只有一份数据源。
 * 模块名唯一来源是 meta.module；本文件只固定分组的展示顺序，不参与命名。
 */
const MODULE_ORDER = [
  '物联网感知监测',
  '远程智能控制',
  '数据中心与AI分析',
  'GIS地理信息',
  '生产农事管理',
  '质量安全溯源',
  '告警消息中心',
  '产销对接与订单',
  '系统后台管理'
]

/**
 * 按 meta.module 聚合 PC 菜单。
 * @param {Array} pcRoutes PC 端子路由集合
 * @returns {Array<{title: string, items: Array}>} 分组菜单
 */
export function buildMenuGroups(pcRoutes) {
  const groups = []
  pcRoutes.forEach((route) => {
    if (route.meta?.menu === false) {
      return
    }
    const moduleName = route.meta?.module || '未分组'
    let group = groups.find((item) => item.title === moduleName)
    if (!group) {
      group = { title: moduleName, items: [] }
      groups.push(group)
    }
    group.items.push({
      path: route.path,
      title: route.meta?.title || route.path,
      pageId: route.meta?.pageId || '',
      icon: route.meta?.icon || 'Document'
    })
  })

  // 组内按页面编号排序，组间按 MODULE_ORDER 排序（未列出的模块排在最后）
  groups.forEach((group) => {
    group.items.sort((a, b) => a.pageId.localeCompare(b.pageId))
  })
  const rank = (title) => {
    const index = MODULE_ORDER.indexOf(title)
    return index === -1 ? MODULE_ORDER.length : index
  }
  groups.sort((a, b) => rank(a.title) - rank(b.title))
  return groups
}

export { MODULE_ORDER }
export default buildMenuGroups
