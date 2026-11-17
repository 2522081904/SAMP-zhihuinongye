/**
 * 告警模块 mock handler（A19 / A20）
 * 负责告警分页查询、告警详情、告警处置与告警统计。
 */
import { alarms, findAlarm, findPlot, NOW_MS } from '../db.js'
import {
  fail,
  formatDateTime,
  inTimeRange,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

// 允许的处置状态
const HANDLE_STATUS = {
  CONFIRMED: '已确认',
  RESOLVED: '已处置',
  IGNORED: '已忽略'
}

// 终态：已处置、已忽略不允许再次处置
const FINAL_STATUS = ['RESOLVED', 'IGNORED']

/**
 * 告警模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleAlarm(ctx) {
  const { method, path, query } = ctx

  // A19 告警列表：GET /alarms
  if (method === 'GET' && matchPath(path, '/alarms')) {
    const keyword = queryValue(query, 'keyword')
    const level = queryValue(query, 'level')
    const status = queryValue(query, 'status')
    const type = queryValue(query, 'type')
    const deviceCode = queryValue(query, 'deviceCode')
    const plotId = queryValue(query, 'plotId')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = alarms
      .filter(
        (alarm) =>
          (!level || alarm.level === level) &&
          (!status || alarm.status === status) &&
          (!type || alarm.type === type) &&
          (!deviceCode || alarm.deviceCode === deviceCode) &&
          (!plotId || alarm.plotId === plotId) &&
          inTimeRange(alarm.createdAt, from, to) &&
          matchKeyword(
            [alarm.alarmNo, alarm.content, alarm.deviceName, alarm.plotName, alarm.typeName],
            keyword
          )
      )
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return ok(paginate(list, query))
  }

  // 扩展：告警统计（P025 顶部卡片与 P026 规则命中分布使用），必须放在 /alarms/:id 之前
  if (method === 'GET' && matchPath(path, '/alarms/statistics')) {
    const byLevel = {}
    const byStatus = {}
    const byPlot = new Map()
    alarms.forEach((alarm) => {
      byLevel[alarm.level] = (byLevel[alarm.level] || 0) + 1
      byStatus[alarm.status] = (byStatus[alarm.status] || 0) + 1
      const current = byPlot.get(alarm.plotName) || { name: alarm.plotName, value: 0 }
      current.value += 1
      byPlot.set(alarm.plotName, current)
    })
    return ok({
      total: alarms.length,
      pendingCount: alarms.filter((alarm) => alarm.status === 'PENDING').length,
      criticalCount: alarms.filter((alarm) => alarm.level === 'CRITICAL').length,
      byLevel: Object.entries(byLevel).map(([name, value]) => ({ name, value })),
      byStatus: Object.entries(byStatus).map(([name, value]) => ({ name, value })),
      byPlot: [...byPlot.values()].sort((left, right) => right.value - left.value).slice(0, 8)
    })
  }

  // A20 告警处置：POST /alarms/{id}/handle
  const handlePath = matchPath(path, '/alarms/:id/handle')
  if (method === 'POST' && handlePath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const alarm = findAlarm(handlePath.id)
    if (!alarm) {
      return fail(40401, `告警 ${handlePath.id} 不存在`)
    }
    if (FINAL_STATUS.includes(alarm.status)) {
      return fail(40901, '该告警已处置，请勿重复提交')
    }
    const body = ctx.body || {}
    const status = String(body.status || '')
      .trim()
      .toUpperCase()
    if (!HANDLE_STATUS[status]) {
      return fail(40001, '处置状态仅支持 CONFIRMED / RESOLVED / IGNORED')
    }
    alarm.status = status
    alarm.statusName = HANDLE_STATUS[status]
    alarm.handledBy = String(body.handler || user.name)
    alarm.handledAt = formatDateTime(NOW_MS)
    alarm.handleRemark = String(body.remark || '')
    return ok(alarm, '告警已处置')
  }

  // A19 告警详情：GET /alarms/{id}
  const alarmPath = matchPath(path, '/alarms/:id')
  if (method === 'GET' && alarmPath) {
    const alarm = findAlarm(alarmPath.id)
    if (!alarm) {
      return fail(40401, `告警 ${alarmPath.id} 不存在`)
    }
    const plot = findPlot(alarm.plotId)
    return ok({
      ...alarm,
      plot: plot
        ? {
            plotId: plot.id,
            plotName: plot.name,
            crop: plot.crop,
            manager: plot.manager,
            greenhouse: plot.greenhouse
          }
        : null
    })
  }

  // 扩展：新增告警（P026 规则测试/演示用，便于前端联调不同级别）
  if (method === 'POST' && matchPath(path, '/alarms')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const content = String(body.content || '').trim()
    const plotId = String(body.plotId || '').trim()
    if (isBlank(content) || isBlank(plotId)) {
      return fail(40001, '告警内容与地块不能为空')
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const id = alarms.reduce((max, alarm) => Math.max(max, alarm.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const alarm = {
      id,
      alarmNo: `ALM-20261117-${String(id).padStart(3, '0')}`,
      level: String(body.level || 'MINOR'),
      levelName: String(body.levelName || '提示'),
      type: String(body.type || 'MANUAL'),
      typeName: String(body.typeName || '人工上报'),
      content,
      deviceCode: String(body.deviceCode || ''),
      deviceName: String(body.deviceName || ''),
      plotId: plot.id,
      plotName: plot.name,
      metric: String(body.metric || ''),
      triggerValue: Number(body.triggerValue) || 0,
      threshold: Number(body.threshold) || 0,
      unit: String(body.unit || ''),
      status: 'PENDING',
      statusName: '待处置',
      createdAt: nowText,
      handledBy: '',
      handledAt: '',
      handleRemark: ''
    }
    alarms.unshift(alarm)
    return ok(alarm, '告警已上报告')
  }

  return null
}
