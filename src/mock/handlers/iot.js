/**
 * 物联网感知模块 mock handler（A03 / A06 / A07）
 * 负责设备台账、设备详情、实时环境数据、历史时序数据。
 */
import {
  devices,
  NOW_MS,
  alarms,
  buildTelemetry,
  controlLogs,
  findDevice,
  findPlot,
  latestMetrics,
  plots,
  SUPPORTED_INTERVALS
} from '../db.js'
import {
  fail,
  formatDateTime,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue,
  toInt
} from '../utils.js'

/**
 * 按查询条件过滤设备。
 * @param {Object} query 查询参数
 * @returns {Array} 过滤后的设备列表
 */
function filterDevices(query) {
  const keyword = queryValue(query, 'keyword')
  const type = queryValue(query, 'type')
  const status = queryValue(query, 'status')
  const plotId = queryValue(query, 'plotId')
  const category = queryValue(query, 'category')
  return devices.filter(
    (device) =>
      (!type || device.type === type) &&
      (!status || device.status === status) &&
      (!plotId || device.plotId === plotId) &&
      (!category || device.category === category) &&
      matchKeyword(
        [device.code, device.name, device.plotName, device.crop, device.manufacturer],
        keyword
      )
  )
}

/**
 * 组装设备详情：在台账字段上补最近遥测、最近告警与最近控制记录。
 * @param {Object} device 设备
 * @returns {Object} 设备详情
 */
function buildDeviceDetail(device) {
  const metrics = latestMetrics(device.code) || {}
  return {
    ...device,
    metrics,
    recentAlarms: alarms.filter((alarm) => alarm.deviceCode === device.code).slice(0, 5),
    recentCommands: controlLogs.filter((log) => log.deviceCode === device.code).slice(0, 5)
  }
}

/**
 * 物联网模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleIot(ctx) {
  const { method, path, query } = ctx

  // A03 设备台账查询：GET /iot/devices
  if (method === 'GET' && matchPath(path, '/iot/devices')) {
    const list = filterDevices(query)
    return ok(paginate(list, query))
  }

  // A03 设备详情：GET /iot/devices/{code}
  const devicePath = matchPath(path, '/iot/devices/:code')
  if (method === 'GET' && devicePath) {
    const device = findDevice(devicePath.code)
    if (!device) {
      return fail(40401, `设备 ${devicePath.code} 不存在`)
    }
    return ok(buildDeviceDetail(device))
  }

  // A06 实时环境数据：GET /iot/realtime
  if (method === 'GET' && matchPath(path, '/iot/realtime')) {
    const plotId = queryValue(query, 'plotId') || plots[0].id
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const plotDevices = devices.filter((device) => device.plotId === plot.id)
    const baseDevice =
      plotDevices.find((device) => device.type === 'TH') ||
      plotDevices.find((device) => device.category === 'SENSOR') ||
      plotDevices[0]
    const baseMetrics = baseDevice ? latestMetrics(baseDevice.code) || {} : {}
    const list = plotDevices.map((device) => {
      const own = latestMetrics(device.code) || {}
      return {
        ...device,
        metrics: {
          ...baseMetrics,
          ...(device.category === 'ACTUATOR' ? { running: Boolean(own.running) } : {})
        }
      }
    })
    return ok({
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      areaMu: plot.areaMu,
      updatedAt: formatDateTime(NOW_MS),
      metrics: baseMetrics,
      devices: list
    })
  }

  // A07 历史时序数据：GET /iot/history
  if (method === 'GET' && matchPath(path, '/iot/history')) {
    const deviceCode = queryValue(query, 'deviceCode')
    if (!deviceCode) {
      return fail(40001, '缺少 deviceCode 参数')
    }
    const device = findDevice(deviceCode)
    if (!device) {
      return fail(40401, `设备 ${deviceCode} 不存在`)
    }
    const intervalText = queryValue(query, 'interval')
    const rawInterval = toInt(intervalText, 60)
    if (intervalText && !SUPPORTED_INTERVALS.includes(rawInterval)) {
      return fail(40001, 'interval 仅支持 30/60/120/240 分钟')
    }
    const interval = SUPPORTED_INTERVALS.includes(rawInterval) ? rawInterval : 60
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const points = buildTelemetry(deviceCode, { from, to, interval })
    return ok({
      deviceCode: device.code,
      deviceName: device.name,
      plotId: device.plotId,
      plotName: device.plotName,
      metric: 'environment',
      interval,
      from: points[0]?.time || from,
      to: points[points.length - 1]?.time || to,
      total: points.length,
      points
    })
  }

  return null
}
