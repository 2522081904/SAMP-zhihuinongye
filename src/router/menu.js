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
 * 按 meta.module 聚合 PC 菜单，并按权限过滤。
 * @param {Array} pcRoutes PC 端子路由集合
 * @param {(code: string) => boolean} [hasPerm] 权限判定函数；缺省时不过滤（保持向后兼容，
 *   PermConfig 等需要全量菜单结构的场景可直接单参调用）
 * @returns {Array<{title: string, items: Array}>} 分组菜单（无可见条目的分组已被丢弃）
 */
export function buildMenuGroups(pcRoutes, hasPerm) {
  const groups = []
  pcRoutes.forEach((route) => {
    if (route.meta?.menu === false) {
      return
    }
    // 页面级权限过滤：无权限的页面不进菜单，避免点进去才 403
    if (route.meta?.perm && hasPerm && !hasPerm(route.meta.perm)) {
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
  // 过滤后可能出现只有标题没有条目的空模块，整组丢弃
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  const rank = (title) => {
    const index = MODULE_ORDER.indexOf(title)
    return index === -1 ? MODULE_ORDER.length : index
  }
  visibleGroups.sort((a, b) => rank(a.title) - rank(b.title))
  return visibleGroups
}

export { MODULE_ORDER }
export default buildMenuGroups
