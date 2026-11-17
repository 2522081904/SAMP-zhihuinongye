/**
 * 分析模块 mock handler（A21 / A22）
 * 负责 AI 诊断记录与报告中心；报表数据为按类型聚合的图表数据。
 */
import {
  aiDiagnoses,
  alarms,
  findPlot,
  findReport,
  harvestBatches,
  NOW_MS,
  orders,
  pesticideLogs,
  reports,
  reportTypeName,
  supplyItems,
  traceCodes
} from '../db.js'
import {
  fail,
  formatDate,
  formatDateTime,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue,
  round
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

// 支持的报表类型
const REPORT_TYPES = ['YIELD', 'INPUT', 'ALARM', 'TRACE', 'TRADE']

// 支持的 AI 诊断类型
const DIAGNOSIS_TYPES = {
  GROWTH: '长势分析',
  PEST: '虫害识别',
  DISEASE: '病害识别'
}

/**
 * 生成最近 7 天日期序列（含当天）。
 * @returns {Array<string>} yyyy-MM-dd 数组
 */
function last7Days() {
  return Array.from({ length: 7 }, (_, index) => formatDate(NOW_MS - (6 - index) * 86400000))
}

/**
 * 按日期聚合最近 7 天的趋势数据。
 * @param {Array} items 数据源
 * @param {string} dateField 日期字段
 * @param {Function} valueFn 取值函数，默认计 1
 * @returns {Array<{label: string, value: number}>} 趋势序列
 */
function buildTrend(items, dateField, valueFn = () => 1) {
  const days = last7Days()
  const bucket = new Map(days.map((day) => [day, 0]))
  items.forEach((item) => {
    const day = String(item[dateField] || '').slice(0, 10)
    if (bucket.has(day)) {
      bucket.set(day, bucket.get(day) + valueFn(item))
    }
  })
  return days.map((day) => ({ label: day.slice(5), value: round(bucket.get(day), 2) }))
}

/**
 * 按字段分组求和，返回降序分布数据。
 * @param {Array} items 数据源
 * @param {Function} nameFn 分组名
 * @param {Function} valueFn 取值函数
 * @returns {Array<{name: string, value: number}>} 分布数据
 */
function groupBy(items, nameFn, valueFn = () => 1) {
  const bucket = new Map()
  items.forEach((item) => {
    const name = nameFn(item)
    bucket.set(name, (bucket.get(name) || 0) + valueFn(item))
  })
  return [...bucket.entries()]
    .map(([name, value]) => ({ name, value: round(value, 2) }))
    .sort((left, right) => right.value - left.value)
}

/**
 * 按报表类型生成汇总指标与图表数据。
 * @param {string} type 报表类型
 * @returns {{summary: Object, charts: Object}} 报表数据
 */
function buildReportPayload(type) {
  if (type === 'YIELD') {
    const totalYield = harvestBatches.reduce((sum, batch) => sum + batch.quantityKg, 0)
    const qualified = harvestBatches.filter((batch) => batch.status === 'QUALIFIED').length
    return {
      summary: {
        totalYieldKg: round(totalYield, 1),
        batchCount: harvestBatches.length,
        qualifiedRate: round((qualified / harvestBatches.length) * 100, 1),
        avgUnitPrice: round(
          harvestBatches.reduce((sum, batch) => sum + batch.unitPrice, 0) / harvestBatches.length,
          2
        )
      },
      charts: {
        trend: buildTrend(harvestBatches, 'harvestDate', (batch) => batch.quantityKg),
        distribution: groupBy(
          harvestBatches,
          (batch) => batch.crop,
          (batch) => batch.quantityKg
        ),
        ranking: groupBy(
          harvestBatches,
          (batch) => batch.plotName,
          (batch) => batch.quantityKg
        ).slice(0, 8)
      }
    }
  }
  if (type === 'INPUT') {
    const totalValue = supplyItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
    return {
      summary: {
        totalValue: round(totalValue, 2),
        pesticideLogCount: pesticideLogs.length,
        lowStockCount: supplyItems.filter((item) => item.status !== 'NORMAL').length,
        avgSafeInterval: round(
          pesticideLogs.reduce((sum, log) => sum + log.safeIntervalDays, 0) / pesticideLogs.length,
          1
        )
      },
      charts: {
        trend: buildTrend(pesticideLogs, 'appliedAt'),
        distribution: groupBy(
          supplyItems,
          (item) => item.categoryName,
          (item) => item.quantity * item.price
        ),
        ranking: groupBy(pesticideLogs, (log) => log.pesticideName).slice(0, 8)
      }
    }
  }
  if (type === 'ALARM') {
    const resolved = alarms.filter((alarm) => alarm.status === 'RESOLVED').length
    return {
      summary: {
        total: alarms.length,
        pendingCount: alarms.filter((alarm) => alarm.status === 'PENDING').length,
        criticalCount: alarms.filter((alarm) => alarm.level === 'CRITICAL').length,
        resolvedRate: round((resolved / alarms.length) * 100, 1)
      },
      charts: {
        trend: buildTrend(alarms, 'createdAt'),
        distribution: groupBy(alarms, (alarm) => alarm.levelName),
        ranking: groupBy(alarms, (alarm) => alarm.plotName).slice(0, 8)
      }
    }
  }
  if (type === 'TRACE') {
    return {
      summary: {
        totalCodes: traceCodes.length,
        printedCount: traceCodes.filter((trace) => trace.printed).length,
        totalScan: traceCodes.reduce((sum, trace) => sum + trace.scanCount, 0),
        voidCount: traceCodes.filter((trace) => trace.status === 'VOID').length
      },
      charts: {
        trend: buildTrend(traceCodes, 'createdAt'),
        distribution: groupBy(traceCodes, (trace) => trace.statusName),
        ranking: groupBy(traceCodes, (trace) => trace.crop).slice(0, 8)
      }
    }
  }
  const totalAmount = orders.reduce((sum, order) => sum + order.totalAmount, 0)
  return {
    summary: {
      orderCount: orders.length,
      totalAmount: round(totalAmount, 2),
      paidAmount: round(
        orders
          .filter((order) => order.status !== 'PENDING' && order.status !== 'CANCELLED')
          .reduce((sum, order) => sum + order.totalAmount, 0),
        2
      ),
      avgOrderAmount: round(totalAmount / orders.length, 2)
    },
    charts: {
      trend: buildTrend(orders, 'createdAt', (order) => order.totalAmount),
      distribution: groupBy(orders, (order) => order.statusName),
      ranking: groupBy(
        orders,
        (order) => order.customerName,
        (order) => order.totalAmount
      ).slice(0, 8)
    }
  }
}

/**
 * 生成 AI 诊断结论与建议（按诊断类型给出不同的确定性文案）。
 * @param {Object} plot 地块
 * @param {string} type 诊断类型
 * @param {number} seed 随机种子（用 id 保证确定性）
 * @returns {{conclusion: string, advice: string, confidence: number}} 诊断结果
 */
function buildDiagnosis(plot, type, seed) {
  const leafIndex = round(2.8 + (seed % 9) * 0.1, 1)
  const confidence = round(0.8 + (seed % 15) / 100, 2)
  if (type === 'PEST') {
    return {
      conclusion: `${plot.crop}叶片背面发现少量蚜虫若虫，百株虫量 ${120 + (seed % 8) * 15} 头，低于防治指标`,
      advice: '建议释放异色瓢虫进行生物防治，3 天后复查虫口密度，暂不需化学农药',
      confidence
    }
  }
  if (type === 'DISEASE') {
    return {
      conclusion: `${plot.crop}下部叶片出现少量${plot.crop === '番茄' ? '早疫病' : '叶斑病'}病斑，病叶率 ${3 + (seed % 5)}%，处于发病初期`,
      advice: '及时摘除病叶并带出棚外销毁，加强通风降湿，必要时选用生物农药轮换防治',
      confidence
    }
  }
  return {
    conclusion: `${plot.crop}整体长势良好，叶面积指数 ${leafIndex}，处于适宜区间，未见明显缺素症状`,
    advice: '维持当前水肥节奏，7 天后复查一次；注意夜间温差，避免裂果',
    confidence
  }
}

/**
 * 分析模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleAnalysis(ctx) {
  const { method, path, query } = ctx

  // A21 AI 诊断记录列表：GET /ai/diagnosis
  if (method === 'GET' && matchPath(path, '/ai/diagnosis')) {
    const keyword = queryValue(query, 'keyword')
    const plotId = queryValue(query, 'plotId')
    const diagnosisType = queryValue(query, 'diagnosisType')
    const status = queryValue(query, 'status')
    const list = aiDiagnoses.filter(
      (item) =>
        (!plotId || item.plotId === plotId) &&
        (!diagnosisType || item.diagnosisType === diagnosisType) &&
        (!status || item.status === status) &&
        matchKeyword([item.diagnosisNo, item.plotName, item.crop, item.conclusion], keyword)
    )
    return ok(paginate(list, query))
  }

  // A21 发起 AI 诊断：POST /ai/diagnosis
  if (method === 'POST' && matchPath(path, '/ai/diagnosis')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const plotId = String(body.plotId || '').trim()
    const type = String(body.diagnosisType || 'GROWTH')
      .trim()
      .toUpperCase()
    if (isBlank(plotId)) {
      return fail(40001, '缺少地块 plotId')
    }
    if (!DIAGNOSIS_TYPES[type]) {
      return fail(40001, `不支持的诊断类型：${type}`)
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const id = aiDiagnoses.reduce((max, item) => Math.max(max, item.id), 0) + 1
    const result = buildDiagnosis(plot, type, id)
    const nowText = formatDateTime(NOW_MS)
    const diagnosis = {
      id,
      diagnosisNo: `AI-20261117-${String(id).padStart(3, '0')}`,
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      diagnosisType: type,
      diagnosisTypeName: DIAGNOSIS_TYPES[type],
      imageUrl: String(body.imageUrl || ''),
      conclusion: result.conclusion,
      advice: result.advice,
      confidence: result.confidence,
      status: 'DONE',
      statusName: '已完成',
      operator: user.name,
      createdAt: nowText
    }
    aiDiagnoses.unshift(diagnosis)
    return ok(diagnosis, 'AI 诊断完成')
  }

  // A22 报表列表：GET /reports
  if (method === 'GET' && matchPath(path, '/reports')) {
    const keyword = queryValue(query, 'keyword')
    const type = queryValue(query, 'type')
    const list = reports.filter(
      (report) =>
        (!type || report.type === type) &&
        matchKeyword([report.reportNo, report.name, report.typeName, report.createdBy], keyword)
    )
    return ok(paginate(list, query))
  }

  // A22 生成报表：POST /reports
  if (method === 'POST' && matchPath(path, '/reports')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const type = String(body.type || '')
      .trim()
      .toUpperCase()
    if (!REPORT_TYPES.includes(type)) {
      return fail(40001, `不支持的报表类型：${type || '空'}`)
    }
    const id = reports.reduce((max, report) => Math.max(max, report.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const report = {
      id,
      reportNo: `RP-202611-${String(id).padStart(3, '0')}`,
      name: String(body.name || `${reportTypeName(type)}报表`),
      type,
      typeName: reportTypeName(type),
      period: String(body.period || nowText.slice(0, 7)),
      status: 'READY',
      statusName: '已生成',
      createdAt: nowText,
      createdBy: user.name
    }
    reports.unshift(report)
    return ok({ ...report, ...buildReportPayload(type) }, '报表已生成')
  }

  // A22 报表详情（含图表数据）：GET /reports/{id}
  const reportPath = matchPath(path, '/reports/:id')
  if (method === 'GET' && reportPath) {
    const report = findReport(reportPath.id)
    if (!report) {
      return fail(40401, `报表 ${reportPath.id} 不存在`)
    }
    return ok({
      ...report,
      ...buildReportPayload(report.type),
      generatedAt: formatDateTime(NOW_MS)
    })
  }

  return null
}
