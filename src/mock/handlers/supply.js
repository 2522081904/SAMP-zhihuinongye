/**
 * 农资模块 mock handler（A13 / A14）
 * 负责农资库存查询与出入库、农药使用台账。
 */
import { findPlot, findSupplyItem, pesticideLogs, runtime, supplyItems, NOW_MS } from '../db.js'
import {
  fail,
  formatDate,
  formatDateTime,
  inTimeRange,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  parseDateTime,
  queryValue,
  round,
  toInt
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

// 库存状态阈值计算
function stockStatus(quantity, safetyStock) {
  if (quantity <= 0) {
    return { status: 'OUT', statusName: '已缺货' }
  }
  if (quantity <= safetyStock) {
    return { status: 'LOW', statusName: '库存偏低' }
  }
  return { status: 'NORMAL', statusName: '正常' }
}

/**
 * 农资模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleSupply(ctx) {
  const { method, path, query } = ctx

  // A13 农资库存列表：GET /supply/stock
  if (method === 'GET' && matchPath(path, '/supply/stock')) {
    const keyword = queryValue(query, 'keyword')
    const category = queryValue(query, 'category')
    const status = queryValue(query, 'status')
    const warehouse = queryValue(query, 'warehouse')
    const lowStock = queryValue(query, 'lowStock')
    const list = supplyItems.filter((item) => {
      if (lowStock === 'true' && item.quantity > item.safetyStock) {
        return false
      }
      return (
        (!category || item.category === category) &&
        (!status || item.status === status) &&
        (!warehouse || item.warehouse === warehouse) &&
        matchKeyword([item.code, item.name, item.supplier, item.spec], keyword)
      )
    })
    return ok(paginate(list, query))
  }

  // A13 农资出入库：POST /supply/stock
  if (method === 'POST' && matchPath(path, '/supply/stock')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const itemId = String(body.itemId ?? body.code ?? '').trim()
    const type = String(body.type || '')
      .trim()
      .toUpperCase()
    const quantity = Number(body.quantity)
    if (isBlank(itemId)) {
      return fail(40001, '缺少农资 itemId')
    }
    if (!['IN', 'OUT'].includes(type)) {
      return fail(40001, '出入库类型仅支持 IN / OUT')
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail(40001, '出入库数量必须大于 0')
    }
    const item = findSupplyItem(itemId)
    if (!item) {
      return fail(40401, `农资 ${itemId} 不存在`)
    }
    if (type === 'OUT' && item.quantity < quantity) {
      return fail(40901, `出库数量超过当前库存（现存 ${item.quantity}${item.unit}）`)
    }
    const before = item.quantity
    item.quantity = type === 'IN' ? item.quantity + quantity : item.quantity - quantity
    Object.assign(item, stockStatus(item.quantity, item.safetyStock))
    item.updatedAt = formatDateTime(NOW_MS)
    const log = {
      id: runtime.stockLogs.length + 1,
      logNo: `SL-202611-${String(runtime.stockLogs.length + 1).padStart(4, '0')}`,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      type,
      typeName: type === 'IN' ? '入库' : '出库',
      quantity,
      unit: item.unit,
      beforeQuantity: before,
      afterQuantity: item.quantity,
      operator: String(body.operator || user.name),
      remark: String(body.remark || ''),
      createdAt: formatDateTime(NOW_MS)
    }
    runtime.stockLogs.unshift(log)
    return ok({ item, log }, type === 'IN' ? '入库成功' : '出库成功')
  }

  // 扩展：农资看板指标（P017 顶部统计卡）
  if (method === 'GET' && matchPath(path, '/supply/statistics')) {
    const totalValue = supplyItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
    const byCategory = new Map()
    supplyItems.forEach((item) => {
      const current = byCategory.get(item.categoryName) || {
        name: item.categoryName,
        quantity: 0,
        itemCount: 0
      }
      current.quantity += item.quantity
      current.itemCount += 1
      byCategory.set(item.categoryName, current)
    })
    return ok({
      itemCount: supplyItems.length,
      totalValue: round(totalValue, 2),
      lowStockCount: supplyItems.filter((item) => item.status !== 'NORMAL').length,
      byCategory: [...byCategory.values()]
    })
  }

  // A14 农药使用台账列表：GET /supply/pesticide-logs
  if (method === 'GET' && matchPath(path, '/supply/pesticide-logs')) {
    const keyword = queryValue(query, 'keyword')
    const plotId = queryValue(query, 'plotId')
    const pesticideName = queryValue(query, 'pesticideName')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = pesticideLogs
      .filter(
        (log) =>
          (!plotId || log.plotId === plotId) &&
          (!pesticideName || log.pesticideName === pesticideName) &&
          inTimeRange(log.appliedAt, from, to) &&
          matchKeyword(
            [log.logNo, log.pesticideName, log.plotName, log.crop, log.operator],
            keyword
          )
      )
      .sort((left, right) => String(right.appliedAt).localeCompare(String(left.appliedAt)))
    return ok(paginate(list, query))
  }

  // A14 新增农药使用台账：POST /supply/pesticide-logs
  if (method === 'POST' && matchPath(path, '/supply/pesticide-logs')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const pesticideName = String(body.pesticideName || '').trim()
    const plotId = String(body.plotId || '').trim()
    const appliedAt = String(body.appliedAt || '').trim()
    const dose = Number(body.dose)
    if (isBlank(pesticideName) || isBlank(plotId) || isBlank(appliedAt)) {
      return fail(40001, '农药名称、地块与施用时间不能为空')
    }
    if (!Number.isFinite(dose) || dose <= 0) {
      return fail(40001, '施用量必须大于 0')
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const safeIntervalDays = toInt(body.safeIntervalDays, 3)
    const appliedMs = parseDateTime(appliedAt)
    const nowText = formatDateTime(NOW_MS)
    const log = {
      id: pesticideLogs.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      logNo: `PS-${formatDate(appliedMs).replace(/-/g, '')}-${String(pesticideLogs.length + 1).padStart(3, '0')}`,
      pesticideName,
      activeIngredient: String(body.activeIngredient || ''),
      formulation: String(body.formulation || ''),
      dilution: String(body.dilution || ''),
      dose,
      unit: String(body.unit || 'ml/亩'),
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      appliedAt,
      operator: String(body.operator || user.name),
      deviceCode: String(body.deviceCode || ''),
      safeIntervalDays,
      withdrawEndDate: formatDate(appliedMs + safeIntervalDays * 86400000),
      remark: String(body.remark || ''),
      createdAt: nowText
    }
    pesticideLogs.unshift(log)
    return ok(log, '农药使用台账已登记')
  }

  return null
}
