/**
 * 采收模块 mock handler（A15）
 * 负责采收批次列表与新建批次。
 */
import { findPlot, harvestBatches, NOW_MS } from '../db.js'
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
  queryValue
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

/**
 * 采收模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleHarvest(ctx) {
  const { method, path, query } = ctx

  // A15 采收批次列表：GET /harvest/batches
  if (method === 'GET' && matchPath(path, '/harvest/batches')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const plotId = queryValue(query, 'plotId')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = harvestBatches
      .filter(
        (batch) =>
          (!status || batch.status === status) &&
          (!plotId || batch.plotId === plotId) &&
          inTimeRange(batch.harvestDate, from, to) &&
          matchKeyword(
            [batch.batchNo, batch.plotName, batch.crop, batch.variety, batch.operator],
            keyword
          )
      )
      .sort((left, right) => String(right.harvestDate).localeCompare(String(left.harvestDate)))
    return ok(paginate(list, query))
  }

  // A15 新建采收批次：POST /harvest/batches
  if (method === 'POST' && matchPath(path, '/harvest/batches')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const plotId = String(body.plotId || '').trim()
    const harvestDate = String(body.harvestDate || '').trim()
    const quantityKg = Number(body.quantityKg)
    if (isBlank(plotId) || isBlank(harvestDate)) {
      return fail(40001, '地块与采收日期不能为空')
    }
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) {
      return fail(40001, '采收数量必须大于 0')
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const providedNo = String(body.batchNo || '').trim()
    if (providedNo && harvestBatches.some((batch) => batch.batchNo === providedNo)) {
      return fail(40901, `批次编号 ${providedNo} 已存在`)
    }
    const id = harvestBatches.reduce((max, batch) => Math.max(max, batch.id), 0) + 1
    const dateCode = formatDate(parseDateTime(harvestDate)).replace(/-/g, '')
    const nowText = formatDateTime(NOW_MS)
    const batch = {
      id,
      batchNo: providedNo || `HB-${dateCode}-${String(id).padStart(3, '0')}`,
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      variety: plot.variety,
      harvestDate,
      quantityKg,
      grade: String(body.grade || '一级'),
      unitPrice: Number(body.unitPrice) || 0,
      operator: String(body.operator || user.name),
      status: 'PENDING',
      statusName: '待检测',
      traceCodeCount: 0,
      remark: String(body.remark || ''),
      createdAt: nowText
    }
    harvestBatches.unshift(batch)
    return ok(batch, '采收批次已创建')
  }

  return null
}
