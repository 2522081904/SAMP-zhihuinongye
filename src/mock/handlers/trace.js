/**
 * 溯源模块 mock handler（A16 / A17 / A18）
 * 负责溯源码生成与查询、公开溯源档案（免登录）、农残检测报告。
 */
import {
  findHarvestBatch,
  findPlot,
  findTraceCode,
  inspections,
  NOW_MS,
  pesticideLogs,
  traceCodes
} from '../db.js'
import {
  fail,
  formatDateTime,
  inTimeRange,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  parseDateTime,
  queryValue,
  toInt
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

// 公开溯源页展示的主体企业信息（演示数据）
const COMPANY = {
  name: '江苏绿谷现代农业发展有限公司',
  creditCode: '91320115MA1X8K2R3T',
  contact: '400-025-6688',
  address: '江苏省南京市江宁区谷里街道现代农业示范园',
  certification: '绿色食品认证 · 编号 GF320115260011'
}

// 溯源码有效期：采收后 180 天
const TRACE_VALID_DAYS = 180

/**
 * 生成溯源码编号。
 * @param {number} sequence 序号
 * @returns {string} 溯源码
 */
function traceCodeOf(sequence) {
  return `TRC-2026-${String(sequence).padStart(6, '0')}`
}

/**
 * 组装公开溯源档案：溯源码 + 批次 + 地块 + 检测 + 用药 + 时间线。
 * @param {Object} trace 溯源码
 * @returns {Object} 公开档案
 */
function buildPublicTrace(trace) {
  const batch = findHarvestBatch(trace.batchId)
  const plot = batch ? findPlot(batch.plotId) : null
  const batchInspections = inspections.filter((item) => item.batchNo === trace.batchNo)
  const relatedPesticides = plot
    ? pesticideLogs.filter((log) => log.plotId === plot.id).slice(0, 3)
    : []
  const timeline = []
  if (plot) {
    timeline.push({
      time: plot.updatedAt,
      title: '地块建档',
      description: `${plot.name}（${plot.areaMu} 亩）完成数字化建档，种植${plot.crop}${plot.variety}`
    })
  }
  relatedPesticides
    .slice()
    .reverse()
    .forEach((log) => {
      timeline.push({
        time: log.appliedAt,
        title: '规范用药',
        description: `${log.pesticideName} ${log.dilution}，安全间隔期 ${log.safeIntervalDays} 天`
      })
    })
  batchInspections.forEach((item) => {
    timeline.push({
      time: item.inspectedAt,
      title: '农残检测',
      description: `${item.lab} 抽检 ${item.inspectItems.length} 项，结论：${item.conclusionName}`
    })
  })
  if (batch) {
    timeline.push({
      time: `${batch.harvestDate} 06:30:00`,
      title: '采收分拣',
      description: `采收 ${batch.quantityKg} 公斤，等级 ${batch.grade}，全程冷链预冷`
    })
  }
  timeline.push({
    time: trace.createdAt,
    title: '赋码上市',
    description: `生成溯源码 ${trace.code}，一物一码可查`
  })
  return {
    traceCode: trace.code,
    status: trace.status,
    statusName: trace.statusName,
    scanCount: trace.scanCount,
    createdAt: trace.createdAt,
    expireAt: trace.expireAt,
    company: COMPANY,
    batch: batch
      ? {
          batchNo: batch.batchNo,
          crop: batch.crop,
          variety: batch.variety,
          harvestDate: batch.harvestDate,
          quantityKg: batch.quantityKg,
          grade: batch.grade,
          operator: batch.operator
        }
      : null,
    plot: plot
      ? {
          plotId: plot.id,
          plotName: plot.name,
          areaMu: plot.areaMu,
          address: plot.address,
          soil: plot.soil,
          irrigation: plot.irrigation,
          manager: plot.manager
        }
      : null,
    inspections: batchInspections,
    pesticides: relatedPesticides,
    timeline
  }
}

/**
 * 溯源模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleTrace(ctx) {
  const { method, path, query } = ctx

  // A16 溯源码列表：GET /trace/codes
  if (method === 'GET' && matchPath(path, '/trace/codes')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const batchId = queryValue(query, 'batchId')
    const batchNo = queryValue(query, 'batchNo')
    const printed = queryValue(query, 'printed')
    const list = traceCodes.filter(
      (trace) =>
        (!status || trace.status === status) &&
        (!batchId || String(trace.batchId) === batchId) &&
        (!batchNo || trace.batchNo === batchNo) &&
        (printed === '' || String(trace.printed) === printed) &&
        matchKeyword([trace.code, trace.batchNo, trace.crop, trace.plotName], keyword)
    )
    return ok(paginate(list, query))
  }

  // A16 生成溯源码：POST /trace/codes
  if (method === 'POST' && matchPath(path, '/trace/codes')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const batchKey = String(body.batchId ?? body.batchNo ?? '').trim()
    if (isBlank(batchKey)) {
      return fail(40001, '缺少采收批次 batchId 或 batchNo')
    }
    const batch = findHarvestBatch(batchKey)
    if (!batch) {
      return fail(40401, `采收批次 ${batchKey} 不存在`)
    }
    const count = toInt(body.count, 1)
    if (count < 1 || count > 100) {
      return fail(40001, '单次生成数量需在 1~100 之间')
    }
    let sequence = traceCodes.reduce((max, trace) => Math.max(max, trace.id), 0)
    const harvestMs = parseDateTime(`${batch.harvestDate} 00:00:00`)
    const created = []
    for (let index = 0; index < count; index += 1) {
      sequence += 1
      const trace = {
        id: sequence,
        code: traceCodeOf(sequence),
        batchId: batch.id,
        batchNo: batch.batchNo,
        crop: batch.crop,
        plotName: batch.plotName,
        status: 'ACTIVE',
        statusName: '有效',
        scanCount: 0,
        printed: false,
        createdAt: formatDateTime(NOW_MS),
        expireAt: formatDateTime(harvestMs + TRACE_VALID_DAYS * 86400000)
      }
      traceCodes.unshift(trace)
      created.push(trace)
    }
    batch.traceCodeCount += count
    return ok({ batchNo: batch.batchNo, count, codes: created }, `已生成 ${count} 个溯源码`)
  }

  // A17 公开溯源档案（免登录，令牌无效也必须可访问）：GET /trace/public/{code}
  const publicPath = matchPath(path, '/trace/public/:code')
  if (method === 'GET' && publicPath) {
    const trace = findTraceCode(publicPath.code)
    if (!trace) {
      return fail(40401, '溯源码不存在，请核对包装上的 12 位编码')
    }
    if (trace.status === 'VOID') {
      return fail(40901, '该溯源码已作废，如有疑问请联系生产企业')
    }
    trace.scanCount += 1
    return ok(buildPublicTrace(trace))
  }

  // A18 检测报告列表：GET /trace/inspections
  if (method === 'GET' && matchPath(path, '/trace/inspections')) {
    const keyword = queryValue(query, 'keyword')
    const conclusion = queryValue(query, 'conclusion')
    const batchNo = queryValue(query, 'batchNo')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = inspections
      .filter(
        (item) =>
          (!conclusion || item.conclusion === conclusion) &&
          (!batchNo || item.batchNo === batchNo) &&
          inTimeRange(item.inspectedAt, from, to) &&
          matchKeyword(
            [item.reportNo, item.batchNo, item.sampleName, item.lab, item.inspector],
            keyword
          )
      )
      .sort((left, right) => String(right.inspectedAt).localeCompare(String(left.inspectedAt)))
    return ok(paginate(list, query))
  }

  // A18 新增检测报告：POST /trace/inspections
  if (method === 'POST' && matchPath(path, '/trace/inspections')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const batchKey = String(body.batchId ?? body.batchNo ?? '').trim()
    if (isBlank(batchKey)) {
      return fail(40001, '缺少采收批次 batchId 或 batchNo')
    }
    const batch = findHarvestBatch(batchKey)
    if (!batch) {
      return fail(40401, `采收批次 ${batchKey} 不存在`)
    }
    const rawItems = Array.isArray(body.inspectItems) ? body.inspectItems : []
    if (rawItems.length === 0) {
      return fail(40001, '检测项目不能为空')
    }
    const inspectItems = rawItems.map((item) => {
      const value = Number(item.value)
      const limit = Number(item.limit)
      const passed = Number.isFinite(value) && Number.isFinite(limit) ? value <= limit : false
      return {
        name: String(item.name || '未命名项目'),
        value: Number.isFinite(value) ? value : 0,
        limit: Number.isFinite(limit) ? limit : 0,
        unit: String(item.unit || 'mg/kg'),
        result: passed ? '合格' : '不合格'
      }
    })
    const allPassed = inspectItems.every((item) => item.result === '合格')
    const id = inspections.reduce((max, item) => Math.max(max, item.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const inspection = {
      id,
      reportNo: `JC-2026-${String(id).padStart(3, '0')}`,
      batchId: batch.id,
      batchNo: batch.batchNo,
      sampleName: String(body.sampleName || `${batch.crop}（${batch.batchNo}）`),
      sampleSource: String(body.sampleSource || batch.plotName),
      inspectItems,
      conclusion: allPassed ? 'PASS' : 'FAIL',
      conclusionName: allPassed ? '合格' : '不合格',
      inspector: String(body.inspector || user.name),
      lab: String(body.lab || '南京市农产品质量检测中心'),
      inspectedAt: String(body.inspectedAt || nowText),
      reportUrl: String(body.reportUrl || ''),
      createdAt: nowText
    }
    inspections.unshift(inspection)
    batch.status = allPassed ? 'QUALIFIED' : 'REJECTED'
    batch.statusName = allPassed ? '检测合格' : '检测不合格'
    return ok(inspection, '检测报告已登记')
  }

  // 扩展：检测报告详情（P023 查看报告使用）
  const inspectionPath = matchPath(path, '/trace/inspections/:id')
  if (method === 'GET' && inspectionPath) {
    const inspection = inspections.find((item) => String(item.id) === String(inspectionPath.id))
    if (!inspection) {
      return fail(40401, `检测报告 ${inspectionPath.id} 不存在`)
    }
    return ok(inspection)
  }

  // 扩展：批次已生成的溯源码（P021 批次展开使用）
  const batchCodesPath = matchPath(path, '/trace/batches/:batchNo/codes')
  if (method === 'GET' && batchCodesPath) {
    const batch = findHarvestBatch(batchCodesPath.batchNo)
    if (!batch) {
      return fail(40401, `采收批次 ${batchCodesPath.batchNo} 不存在`)
    }
    const codes = traceCodes.filter((trace) => trace.batchNo === batch.batchNo)
    return ok({ batchNo: batch.batchNo, total: codes.length, list: codes })
  }

  return null
}
