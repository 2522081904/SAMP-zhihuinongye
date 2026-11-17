/**
 * 远程控制模块 mock handler（A04 / A05 / A08 / A09）
 * 负责指令下发、指令回执、控制策略、控制日志，以及安全锁的演示接口。
 */
import {
  controlLogs,
  findDevice,
  findPlot,
  runtime,
  setSafetyLock,
  strategies,
  NOW_MS
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
  queryValue,
  round,
  toInt
} from '../utils.js'
import { currentUser, forbidden, unauthorized } from './auth.js'

// 指令动作字典：编码 → 中文名
const ACTION_NAMES = {
  ON: '开机',
  OFF: '关机',
  OPEN: '开启',
  CLOSE: '关闭',
  SET_MODE: '切换模式',
  RESTART: '重启'
}

// 指令状态：首次查询为 PENDING，第二次查询起返回 SUCCESS，模拟网关下发完成
const COMMAND_PENDING = 'PENDING'
const COMMAND_SUCCESS = 'SUCCESS'

/**
 * 生成新指令编号。
 * @returns {string} 指令编号
 */
function nextCommandNo() {
  runtime.commandSequence += 1
  return `CMD-20261117-${String(runtime.commandSequence).padStart(4, '0')}`
}

/**
 * 远程控制模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleCtl(ctx) {
  const { method, path, query } = ctx

  // A04 下发控制指令：POST /ctl/commands
  if (method === 'POST' && matchPath(path, '/ctl/commands')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const requestId = String(ctx.headers['x-request-id'] || '').trim()
    if (!requestId) {
      return fail(40001, '缺少 X-Request-Id 请求头，无法保证指令幂等')
    }
    if (runtime.requestIds.has(requestId)) {
      return fail(40901, '该请求编号已提交过，请勿重复下发')
    }
    if (runtime.safetyLock) {
      return fail(42301, '安全锁已开启，远程控制已锁定')
    }
    const body = ctx.body || {}
    const deviceCode = String(body.deviceCode || '').trim()
    const action = String(body.action || '')
      .trim()
      .toUpperCase()
    if (isBlank(deviceCode) || isBlank(action)) {
      return fail(40001, 'deviceCode 与 action 不能为空')
    }
    if (!ACTION_NAMES[action]) {
      return fail(40001, `不支持的指令动作：${action}`)
    }
    const device = findDevice(deviceCode)
    if (!device) {
      return fail(40401, `设备 ${deviceCode} 不存在`)
    }
    if (device.category !== 'ACTUATOR') {
      return fail(40901, '该设备为采集类设备，不支持远程控制')
    }
    const command = {
      requestId,
      commandId: nextCommandNo(),
      deviceCode: device.code,
      deviceName: device.name,
      deviceType: device.type,
      plotId: device.plotId,
      plotName: device.plotName,
      action,
      actionName: ACTION_NAMES[action],
      params: body.params || {},
      remark: String(body.remark || ''),
      operator: user.name,
      status: COMMAND_PENDING,
      statusName: '下发中',
      queryCount: 0,
      createdAt: formatDateTime(NOW_MS + runtime.commandSequence * 1000),
      finishedAt: '',
      result: ''
    }
    runtime.requestIds.add(requestId)
    runtime.commands.set(requestId, command)
    return ok(command, '指令已受理，正在下发')
  }

  // A05 指令执行回执：GET /ctl/commands/{requestId}
  const commandPath = matchPath(path, '/ctl/commands/:requestId')
  if (method === 'GET' && commandPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const command = runtime.commands.get(commandPath.requestId)
    if (!command) {
      return fail(40401, '指令不存在或已过期')
    }
    command.queryCount += 1
    if (command.queryCount >= 2 && command.status === COMMAND_PENDING) {
      command.status = COMMAND_SUCCESS
      command.statusName = '执行成功'
      command.finishedAt = formatDateTime(NOW_MS + runtime.commandSequence * 1000 + 8000)
      command.result = '设备已响应并反馈'
    }
    return ok({ ...command })
  }

  // A08 控制策略列表：GET /ctl/strategies
  if (method === 'GET' && matchPath(path, '/ctl/strategies')) {
    const keyword = queryValue(query, 'keyword')
    const plotId = queryValue(query, 'plotId')
    const metric = queryValue(query, 'metric')
    const enabled = queryValue(query, 'enabled')
    const list = strategies.filter(
      (item) =>
        (!plotId || item.plotId === plotId) &&
        (!metric || item.metric === metric) &&
        (enabled === '' || String(item.enabled) === enabled) &&
        matchKeyword([item.name, item.strategyNo, item.plotName, item.metricName], keyword)
    )
    return ok(paginate(list, query))
  }

  // A08 新增控制策略：POST /ctl/strategies
  if (method === 'POST' && matchPath(path, '/ctl/strategies')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const name = String(body.name || '').trim()
    const plotId = String(body.plotId || '').trim()
    const metric = String(body.metric || '').trim()
    const threshold = Number(body.threshold)
    if (isBlank(name) || isBlank(plotId) || isBlank(metric) || !Number.isFinite(threshold)) {
      return fail(40001, '策略名称、地块、监测指标与阈值不能为空')
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const id = strategies.reduce((max, item) => Math.max(max, item.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const strategy = {
      id,
      strategyNo: `STG-2026-${String(id).padStart(3, '0')}`,
      name,
      plotId: plot.id,
      plotName: plot.name,
      deviceType: String(body.deviceType || 'TH'),
      metric,
      metricName: String(body.metricName || metric),
      operator: String(body.operator || '>'),
      threshold: round(threshold, 1),
      duration: toInt(body.duration, 5),
      action: String(body.action || 'OPEN_FAN'),
      actionName: String(body.actionName || '开启风机'),
      level: String(body.level || 'MAJOR'),
      enabled: body.enabled !== false,
      priority: toInt(body.priority, 5),
      remark: String(body.remark || ''),
      createdAt: nowText,
      updatedAt: nowText
    }
    strategies.unshift(strategy)
    return ok(strategy, '策略创建成功')
  }

  // A08 修改控制策略：PUT /ctl/strategies/{id}
  const strategyPath = matchPath(path, '/ctl/strategies/:id')
  if (method === 'PUT' && strategyPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const strategy = strategies.find((item) => String(item.id) === String(strategyPath.id))
    if (!strategy) {
      return fail(40401, `策略 ${strategyPath.id} 不存在`)
    }
    if (!(user.roleCode === 'ADMIN' || (user.perms || []).includes('*'))) {
      return forbidden('策略维护仅限管理员')
    }
    const body = ctx.body || {}
    const editable = [
      'name',
      'metric',
      'metricName',
      'operator',
      'duration',
      'action',
      'actionName',
      'level',
      'enabled',
      'priority',
      'deviceType',
      'remark'
    ]
    editable.forEach((key) => {
      if (body[key] !== undefined) {
        strategy[key] = body[key]
      }
    })
    if (body.plotId !== undefined) {
      const plot = findPlot(String(body.plotId))
      if (!plot) {
        return fail(40401, `地块 ${body.plotId} 不存在`)
      }
      strategy.plotId = plot.id
      strategy.plotName = plot.name
    }
    if (body.threshold !== undefined) {
      const threshold = Number(body.threshold)
      if (!Number.isFinite(threshold)) {
        return fail(40001, '阈值必须为数字')
      }
      strategy.threshold = round(threshold, 1)
    }
    strategy.updatedAt = formatDateTime(NOW_MS)
    return ok(strategy, '策略已更新')
  }

  // A09 控制日志：GET /ctl/logs
  if (method === 'GET' && matchPath(path, '/ctl/logs')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const deviceCode = queryValue(query, 'deviceCode')
    const operator = queryValue(query, 'operator')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = controlLogs
      .filter(
        (log) =>
          (!status || log.status === status) &&
          (!deviceCode || log.deviceCode === deviceCode) &&
          (!operator || log.operator === operator) &&
          inTimeRange(log.createdAt, from, to) &&
          matchKeyword([log.logNo, log.deviceName, log.actionName, log.operator], keyword)
      )
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return ok(paginate(list, query))
  }

  // 扩展：安全锁状态查询与切换（P007 演示 42301 场景用，不属于 A01–A26 契约）
  if (method === 'GET' && matchPath(path, '/ctl/safety-lock')) {
    return ok({ safetyLock: runtime.safetyLock, updatedAt: formatDateTime(NOW_MS) })
  }
  if (method === 'POST' && matchPath(path, '/ctl/safety-lock')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const locked = Boolean((ctx.body || {}).locked)
    setSafetyLock(locked)
    return ok(
      { safetyLock: runtime.safetyLock, updatedAt: formatDateTime(NOW_MS), operator: user.name },
      locked ? '安全锁已开启' : '安全锁已解除'
    )
  }

  return null
}
