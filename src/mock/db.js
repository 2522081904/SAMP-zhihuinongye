/**
 * mock 内存种子数据（确定性）
 *
 * 设计要点：
 * 1. 所有种子数据由「下标 + 正弦函数 + 字符哈希」推导，不调用 Math.random，
 *    因此刷新页面、重启开发服务器得到的数据完全一致，便于对照联调；
 * 2. 时序数据只保留生成函数 buildTelemetry()，按需计算 7×24 个点，不预先写死几万行；
 * 3. 写接口（下发指令、告警处置、出入库、打卡等）直接修改这里的内存对象，
 *    刷新页面即复位，不落盘、不影响真实数据；
 * 4. 业务时区固定东八区，时间统一输出 `yyyy-MM-dd HH:mm:ss`。
 */
import { beijingParts, formatDate, formatDateTime, parseDateTime, round, makeNo } from './utils.js'

// 固定的“当前时间”：整个 mock 世界以此为基准，保证同一份数据每次加载都一致
export const MOCK_NOW = '2026-11-16 18:30:00'
export const NOW_MS = parseDateTime(MOCK_NOW)

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// 时序数据的固定窗口：2026-11-10 00:00 ~ 2026-11-16 23:30，共 7 天
const TELEMETRY_START_MS = parseDateTime('2026-11-10 00:00:00')
const TELEMETRY_END_MS = parseDateTime('2026-11-16 23:30:00')
const TELEMETRY_STEP_MINUTES = 30
// 历史查询支持的采样间隔（分钟）
export const SUPPORTED_INTERVALS = [30, 60, 120, 240]

// 人员姓名池：农夫、运维、管理员三类角色反复出现在不同业务单据里，保持人名一致
const FARMER_NAMES = ['张桂芳', '刘志强', '陈秀兰']
const OPS_NAMES = ['李运维', '王建国']
export const STAFF_NAMES = [...FARMER_NAMES, ...OPS_NAMES]

/**
 * 生成地块多边形：以南京江宁近郊为基准点，按地块序号向东、向北错开。
 * 坐标顺序为 [经度, 纬度]，与 GeoJSON 一致。
 * @param {number} index 地块序号（0 起）
 * @returns {Array<Array<number>>} 闭合前的四个角点
 */
function makeBoundary(index) {
  const lng = 118.8421 + (index % 4) * 0.0018
  const lat = 31.9512 + Math.floor(index / 4) * 0.0014
  const deltaLng = 0.00052 + (index % 3) * 0.00006
  const deltaLat = 0.00036 + (index % 4) * 0.00005
  return [
    [round(lng, 6), round(lat, 6)],
    [round(lng + deltaLng, 6), round(lat + 0.00002, 6)],
    [round(lng + deltaLng - 0.00004, 6), round(lat + deltaLat, 6)],
    [round(lng - 0.00002, 6), round(lat + deltaLat - 0.00003, 6)]
  ]
}

// 地块基础信息：作物、品种、面积取自设施农业园区的常见配置
const PLOT_SEEDS = [
  {
    id: 'PLOT-01',
    name: '一号连栋温室',
    shortName: '1号温室',
    crop: '番茄',
    variety: '瑞粉 882',
    areaMu: 12.6,
    greenhouse: true,
    manager: '张桂芳',
    soil: '壤土',
    irrigation: '水肥一体化滴灌'
  },
  {
    id: 'PLOT-02',
    name: '二号连栋温室',
    shortName: '2号温室',
    crop: '黄瓜',
    variety: '津优 35',
    areaMu: 11.8,
    greenhouse: true,
    manager: '刘志强',
    soil: '壤土',
    irrigation: '膜下滴灌'
  },
  {
    id: 'PLOT-03',
    name: '三号日光温室',
    shortName: '3号温室',
    crop: '辣椒',
    variety: '苏椒 5 号',
    areaMu: 9.4,
    greenhouse: true,
    manager: '陈秀兰',
    soil: '沙壤土',
    irrigation: '膜下滴灌'
  },
  {
    id: 'PLOT-04',
    name: '四号育苗棚',
    shortName: '4号苗棚',
    crop: '番茄苗',
    variety: '金棚 1 号',
    areaMu: 6.2,
    greenhouse: true,
    manager: '张桂芳',
    soil: '育苗基质',
    irrigation: '微喷'
  },
  {
    id: 'PLOT-05',
    name: '东区露天田',
    shortName: '东区大田',
    crop: '小麦',
    variety: '宁麦 13',
    areaMu: 86.5,
    greenhouse: false,
    manager: '王建国',
    soil: '黏壤土',
    irrigation: '渠灌'
  },
  {
    id: 'PLOT-06',
    name: '西区果园',
    shortName: '西区果园',
    crop: '苹果',
    variety: '富士',
    areaMu: 42.3,
    greenhouse: false,
    manager: '刘志强',
    soil: '黄棕壤',
    irrigation: '滴灌'
  },
  {
    id: 'PLOT-07',
    name: '南区水稻田',
    shortName: '南区稻田',
    crop: '水稻',
    variety: '南粳 46',
    areaMu: 120.8,
    greenhouse: false,
    manager: '王建国',
    soil: '水稻土',
    irrigation: '漫灌'
  },
  {
    id: 'PLOT-08',
    name: '北区中药材园',
    shortName: '北区药园',
    crop: '金银花',
    variety: '九丰 1 号',
    areaMu: 35.6,
    greenhouse: false,
    manager: '陈秀兰',
    soil: '沙壤土',
    irrigation: '滴灌'
  }
]

/**
 * 地块列表：8 个园区/地块，含 GeoJSON 风格边界与面积。
 * 字段说明：id/code 同为地块编号；boundary 为 [经度, 纬度] 数组；areaMu 单位亩。
 */
export const plots = PLOT_SEEDS.map((seed, index) => ({
  ...seed,
  code: seed.id,
  center: makeBoundary(index)[0],
  boundary: makeBoundary(index),
  address: `江苏省南京市江宁区谷里街道现代农业示范园 ${index + 1} 区`,
  updatedAt: formatDateTime(NOW_MS - (index + 1) * DAY_MS),
  updatedBy: OPS_NAMES[index % OPS_NAMES.length]
}))

/**
 * 用鞋带公式估算地块面积（亩）。
 * 先将经纬度按当前纬度投影为米，避免直接对角度做面积计算带来的量级错误。
 * @param {Array<Array<number>>} boundary 边界点数组 [经度, 纬度]
 * @returns {number} 面积（亩，保留两位小数）
 */
export function computePolygonAreaMu(boundary = []) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return 0
  }
  const averageLat =
    boundary.reduce((sum, point) => sum + Number(point[1] || 0), 0) / boundary.length
  const metersPerLng = 111320 * Math.cos((averageLat * Math.PI) / 180)
  const metersPerLat = 110540
  let doubleArea = 0
  for (let index = 0; index < boundary.length; index += 1) {
    const [lng1, lat1] = boundary[index]
    const [lng2, lat2] = boundary[(index + 1) % boundary.length]
    doubleArea +=
      lng1 * metersPerLng * (lat2 * metersPerLat) - lng2 * metersPerLng * (lat1 * metersPerLat)
  }
  // 1 亩 ≈ 666.6667 平方米
  return round(Math.abs(doubleArea / 2) / 666.6667, 2)
}

// 设备类型字典：letter 用于设备编码，category 决定前端展示的图标与操作按钮
const DEVICE_TYPES = {
  TH: { name: '温湿度传感器', letter: 'T', category: 'SENSOR' },
  LUX: { name: '光照传感器', letter: 'L', category: 'SENSOR' },
  CO2: { name: 'CO₂浓度传感器', letter: 'C', category: 'SENSOR' },
  SM: { name: '土壤墒情仪', letter: 'S', category: 'SENSOR' },
  WS: { name: '小型气象站', letter: 'W', category: 'SENSOR' },
  CAM: { name: '高清球机', letter: 'M', category: 'CAMERA' },
  VALVE: { name: '灌溉电磁阀', letter: 'V', category: 'ACTUATOR' },
  FAN: { name: '环流风机', letter: 'F', category: 'ACTUATOR' },
  LIGHT: { name: '补光灯', letter: 'G', category: 'ACTUATOR' },
  CURTAIN: { name: '卷帘', letter: 'R', category: 'ACTUATOR' }
}

const CATEGORY_NAMES = {
  SENSOR: '传感器',
  CAMERA: '视频设备',
  ACTUATOR: '执行设备'
}

// 每个地块固定 5 台设备：温室以环境传感器 + 摄像头 + 执行机构为主，大田以气象站为主
const PLOT_DEVICE_TYPES = [
  ['TH', 'LUX', 'SM', 'CAM', 'VALVE'],
  ['TH', 'LUX', 'CO2', 'CAM', 'FAN'],
  ['TH', 'LUX', 'SM', 'CAM', 'FAN'],
  ['TH', 'LUX', 'SM', 'CAM', 'VALVE'],
  ['WS', 'SM', 'CAM', 'VALVE', 'FAN'],
  ['WS', 'SM', 'CAM', 'VALVE', 'FAN'],
  ['WS', 'SM', 'CAM', 'VALVE', 'FAN'],
  ['WS', 'SM', 'CAM', 'VALVE', 'FAN']
]

const DEVICE_STATUS_NAMES = {
  ONLINE: '在线',
  OFFLINE: '离线',
  FAULT: '故障'
}

const MANUFACTURERS = ['海康威视', '托普云农', '中科物联', '汉枫科技']

/**
 * 设备台账：8 个地块 × 5 台 = 40 台，另为前 4 个温室地块补充补光灯与卷帘各 1 台，共 48 台。
 * 编码规则 `EQ-{地块号}{类型字母}-{四位序号}`，例如 EQ-1T-0001、EQ-5W-0021。
 * 状态按固定序号指定为少量离线/故障，其余在线，便于页面演示三种状态。
 */
export const devices = []
let deviceSequence = 0
plots.forEach((plot, plotIndex) => {
  PLOT_DEVICE_TYPES[plotIndex].forEach((typeCode, typeIndex) => {
    deviceSequence += 1
    const type = DEVICE_TYPES[typeCode]
    const status =
      deviceSequence === 8
        ? 'FAULT'
        : deviceSequence === 18 || deviceSequence === 32
          ? 'OFFLINE'
          : 'ONLINE'
    const code = `EQ-${plotIndex + 1}${type.letter}-${String(deviceSequence).padStart(4, '0')}`
    devices.push({
      id: deviceSequence,
      code,
      name: `${plot.shortName}${type.name}${String(typeIndex + 1).padStart(2, '0')}`,
      type: typeCode,
      typeName: type.name,
      category: type.category,
      categoryName: CATEGORY_NAMES[type.category],
      status,
      statusName: DEVICE_STATUS_NAMES[status],
      online: status === 'ONLINE',
      lastSeen: formatDateTime(
        status === 'ONLINE'
          ? NOW_MS - ((deviceSequence % 7) + 1) * MINUTE_MS
          : NOW_MS - (6 + (deviceSequence % 5)) * HOUR_MS
      ),
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      firmware: `v2.${deviceSequence % 4}.${deviceSequence % 7}`,
      installDate: formatDate(NOW_MS - (30 + deviceSequence * 3) * DAY_MS),
      signal: status === 'OFFLINE' ? 0 : (deviceSequence % 5) + 1,
      ip: `10.20.${plotIndex + 1}.${10 + typeIndex}`,
      manufacturer: MANUFACTURERS[deviceSequence % MANUFACTURERS.length],
      lastMaintainAt: formatDate(NOW_MS - ((deviceSequence % 20) + 3) * DAY_MS)
    })
  })
})

// 前 4 个温室地块补充补光灯与卷帘，保证 P007 四类执行器控制面板都有真实设备可演示
const EXTRA_ACTUATOR_TYPES = ['LIGHT', 'CURTAIN']
plots.slice(0, 4).forEach((plot, plotIndex) => {
  EXTRA_ACTUATOR_TYPES.forEach((typeCode, typeIndex) => {
    deviceSequence += 1
    const type = DEVICE_TYPES[typeCode]
    const code = `EQ-${plotIndex + 1}${type.letter}-${String(deviceSequence).padStart(4, '0')}`
    devices.push({
      id: deviceSequence,
      code,
      name: `${plot.shortName}${type.name}${String(PLOT_DEVICE_TYPES[plotIndex].length + typeIndex + 1).padStart(2, '0')}`,
      type: typeCode,
      typeName: type.name,
      category: type.category,
      categoryName: CATEGORY_NAMES[type.category],
      status: 'ONLINE',
      statusName: DEVICE_STATUS_NAMES.ONLINE,
      online: true,
      lastSeen: formatDateTime(NOW_MS - ((deviceSequence % 7) + 1) * MINUTE_MS),
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      firmware: `v2.${deviceSequence % 4}.${deviceSequence % 7}`,
      installDate: formatDate(NOW_MS - (30 + deviceSequence * 3) * DAY_MS),
      signal: (deviceSequence % 5) + 1,
      ip: `10.20.${plotIndex + 1}.${20 + typeIndex}`,
      manufacturer: MANUFACTURERS[deviceSequence % MANUFACTURERS.length],
      lastMaintainAt: formatDate(NOW_MS - ((deviceSequence % 20) + 3) * DAY_MS)
    })
  })
})

/**
 * 由设备编码推导稳定哈希值，作为时序波形的个体差异因子。
 * @param {string} code 设备编码
 * @returns {number} 0 ~ 1000002 的整数
 */
function deviceSeed(code) {
  let hashValue = 0
  for (let index = 0; index < code.length; index += 1) {
    hashValue = (hashValue * 31 + code.charCodeAt(index)) % 1000003
  }
  return hashValue
}

/**
 * 生成单台设备在某一时刻的环境采样点。
 * 数值由日内正弦波 + 天级正弦波 + 设备个体偏移叠加而成，结果确定且连续。
 * @param {Object} device 设备对象
 * @param {number} timestamp 采样时间戳
 * @returns {Object} 采样点
 */
function buildPoint(device, timestamp) {
  const parts = beijingParts(timestamp)
  const seed = deviceSeed(device.code)
  const offset = (seed % 97) / 97
  const hour = parts.hour + parts.minute / 60
  const dayIndex = Math.floor((timestamp - TELEMETRY_START_MS) / DAY_MS)
  // 日变化：凌晨 6 点最低、午后 14 点前后最高
  const daily = Math.sin(((hour - 6) / 24) * Math.PI * 2)
  // 天级波动：7 天里缓慢升降，模拟天气过程
  const dayWave = Math.sin((((dayIndex % 7) + 1) / 7) * Math.PI * 2 + offset)

  const point = {
    time: formatDateTime(timestamp),
    temperature: round(18.2 + offset * 2.4 + daily * 4.1 + dayWave * 0.7, 1),
    humidity: round(71 - daily * 11.5 + offset * 3.2, 1),
    light: Math.round(
      Math.max(0, Math.sin(((hour - 6.5) / 12) * Math.PI)) * (26000 + offset * 8000)
    ),
    co2: Math.round(430 + Math.sin(((hour - 4) / 24) * Math.PI * 2) * 58 + offset * 42),
    soilMoisture: round(24 + offset * 4 + dayWave * 1.6 - daily * 0.8, 1),
    soilTemperature: round(15.6 + offset * 1.8 + daily * 3.2 + dayWave * 0.5, 1),
    ph: round(6.4 + offset * 0.22, 2),
    ec: round(1.4 + offset * 0.35, 2),
    windSpeed: round(1.2 + offset * 1.5 + Math.abs(daily) * 0.8, 1)
  }

  if (device.category === 'ACTUATOR') {
    // 执行设备额外给出运行态：白天工作时段按固定规律启停
    point.running = hour >= 8 && hour < 18 && (dayIndex + seed) % 4 !== 0 ? 1 : 0
  }
  return point
}

/**
 * 生成设备历史时序数据（7×24 窗口内按采样间隔取点）。
 * @param {string} deviceCode 设备编码
 * @param {Object} options 查询条件
 * @param {string} [options.from] 起始时间
 * @param {string} [options.to] 结束时间
 * @param {number} [options.interval] 采样间隔（分钟，支持 30/60/120/240）
 * @returns {Array<Object>} 采样点数组
 */
export function buildTelemetry(deviceCode, options = {}) {
  const device = findDevice(deviceCode)
  if (!device) {
    return []
  }
  const interval = SUPPORTED_INTERVALS.includes(Number(options.interval))
    ? Number(options.interval)
    : 60
  const stepMs = interval * MINUTE_MS
  const rawFrom = parseDateTime(options.from)
  const rawTo = parseDateTime(options.to)
  const fromMs = Number.isFinite(rawFrom) ? rawFrom : TELEMETRY_END_MS - DAY_MS
  const toMs = Number.isFinite(rawTo) ? rawTo : TELEMETRY_END_MS
  // 时间戳按间隔对齐：东八区偏移是 30 分钟的整数倍，因此对齐后仍落在整点/半点
  const startMs = Math.ceil(fromMs / stepMs) * stepMs
  const points = []
  for (let timestamp = startMs; timestamp <= toMs; timestamp += stepMs) {
    if (timestamp < TELEMETRY_START_MS || timestamp > TELEMETRY_END_MS) {
      continue
    }
    points.push(buildPoint(device, timestamp))
  }
  return points
}

/**
 * 取设备最新一次采样（对齐到 30 分钟）。
 * @param {string} deviceCode 设备编码
 * @returns {Object|null} 采样点
 */
export function latestMetrics(deviceCode) {
  const device = findDevice(deviceCode)
  if (!device) {
    return null
  }
  const bucketMs =
    Math.floor(NOW_MS / (TELEMETRY_STEP_MINUTES * MINUTE_MS)) * TELEMETRY_STEP_MINUTES * MINUTE_MS
  return buildPoint(device, bucketMs)
}

// 告警模板：覆盖温度、湿度、土壤、CO₂、光照、设备离线与执行器故障七类
const ALARM_TEMPLATES = [
  {
    level: 'CRITICAL',
    type: 'TEMPERATURE_HIGH',
    typeName: '温度超上限',
    metric: 'temperature',
    unit: '℃',
    threshold: 32,
    delta: 3.6,
    content: '棚内温度持续高于上限，已自动开启顶部通风'
  },
  {
    level: 'CRITICAL',
    type: 'HUMIDITY_HIGH',
    typeName: '湿度过高',
    metric: 'humidity',
    unit: '%',
    threshold: 90,
    delta: 4.2,
    content: '空气湿度超出警戒值，存在灰霉病风险'
  },
  {
    level: 'MAJOR',
    type: 'SOIL_DRY',
    typeName: '土壤缺水',
    metric: 'soilMoisture',
    unit: '%',
    threshold: 18,
    delta: -2.5,
    content: '土壤含水率低于灌溉阈值，建议启动滴灌'
  },
  {
    level: 'MAJOR',
    type: 'CO2_LOW',
    typeName: 'CO₂ 偏低',
    metric: 'co2',
    unit: 'ppm',
    threshold: 350,
    delta: -40,
    content: 'CO₂ 浓度偏低，建议通风补气'
  },
  {
    level: 'MINOR',
    type: 'DEVICE_OFFLINE',
    typeName: '设备离线',
    metric: 'online',
    unit: '',
    threshold: 1,
    delta: 0,
    content: '设备心跳中断，请检查供电与网络'
  },
  {
    level: 'MINOR',
    type: 'LIGHT_LOW',
    typeName: '光照不足',
    metric: 'light',
    unit: 'lx',
    threshold: 8000,
    delta: -1500,
    content: '光照强度不足，建议补光或清洁棚膜'
  },
  {
    level: 'MAJOR',
    type: 'VALVE_FAULT',
    typeName: '执行器故障',
    metric: 'running',
    unit: '',
    threshold: 1,
    delta: 0,
    content: '电磁阀执行超时未反馈，请现场确认'
  }
]

const ALARM_LEVEL_NAMES = { CRITICAL: '严重', MAJOR: '重要', MINOR: '次要' }
const ALARM_STATUS_NAMES = {
  PENDING: '待处置',
  CONFIRMED: '已确认',
  RESOLVED: '已处置',
  IGNORED: '已忽略'
}

/**
 * 告警列表：60 条，时间连续覆盖最近 4 天。
 * 前 6 条保留待处置/已确认状态，方便演示处置流程（A20）。
 */
export const alarms = Array.from({ length: 60 }, (_, index) => {
  const device = devices[(index * 7) % devices.length]
  const template = ALARM_TEMPLATES[index % ALARM_TEMPLATES.length]
  const status =
    index < 6
      ? index % 2 === 0
        ? 'PENDING'
        : 'CONFIRMED'
      : index % 13 === 0
        ? 'IGNORED'
        : index % 17 === 0
          ? 'CONFIRMED'
          : 'RESOLVED'
  const handled = status !== 'PENDING'
  const createdMs = NOW_MS - (index * 97 + 15) * MINUTE_MS
  const triggerValue =
    template.metric === 'online' || template.metric === 'running'
      ? template.threshold + template.delta
      : round(template.threshold + template.delta, 2)
  return {
    id: index + 1,
    alarmNo: makeNo('ALM', index + 1, formatDate(createdMs).replace(/-/g, '')),
    level: template.level,
    levelName: ALARM_LEVEL_NAMES[template.level],
    type: template.type,
    typeName: template.typeName,
    content: template.content,
    deviceCode: device.code,
    deviceName: device.name,
    plotId: device.plotId,
    plotName: device.plotName,
    metric: template.metric,
    triggerValue,
    threshold: template.threshold,
    unit: template.unit,
    status,
    statusName: ALARM_STATUS_NAMES[status],
    createdAt: formatDateTime(createdMs),
    handledBy: handled ? OPS_NAMES[index % OPS_NAMES.length] : '',
    handledAt: handled ? formatDateTime(createdMs + 20 * MINUTE_MS) : '',
    handleRemark: handled ? '已现场核查，设备恢复正常' : ''
  }
})

const PLAN_STATUS_NAMES = {
  DRAFT: '草稿',
  DISPATCHED: '已派单',
  DOING: '执行中',
  DONE: '已完成',
  CANCELLED: '已取消'
}

const PLAN_TITLES = [
  '番茄整枝打杈',
  '水肥一体化追肥',
  '棚膜放风降湿',
  '病虫害绿色防控',
  '疏花疏果',
  '土壤消毒处理',
  '滴灌管网检修',
  '果实采收与分级',
  '育苗盘移栽',
  '果园冬季修剪'
]

const PLAN_STATUS_CYCLE = ['DRAFT', 'DONE', 'DISPATCHED', 'DOING', 'DONE', 'CANCELLED']

/**
 * 农事计划：30 条（A11），日期在 11 月 9 日 ~ 11 月 24 日之间，含过去与未来。
 */
export const farmPlans = Array.from({ length: 30 }, (_, index) => {
  const plot = plots[index % plots.length]
  const plannedMs = NOW_MS + (index - 18) * 12 * HOUR_MS
  const status = PLAN_STATUS_CYCLE[index % PLAN_STATUS_CYCLE.length]
  const owner = FARMER_NAMES[index % FARMER_NAMES.length]
  const secondWorker = FARMER_NAMES[(index + 1) % FARMER_NAMES.length]
  return {
    id: index + 1,
    planNo: makeNo('PL', index + 1, formatDate(plannedMs).slice(0, 7).replace(/-/g, '')),
    title: PLAN_TITLES[index % PLAN_TITLES.length],
    plotId: plot.id,
    plotName: plot.name,
    crop: plot.crop,
    planDate: formatDate(plannedMs),
    startTime: index % 2 === 0 ? '08:00' : '14:00',
    endTime: index % 2 === 0 ? '11:30' : '17:30',
    status,
    statusName: PLAN_STATUS_NAMES[status],
    priority: index % 4 === 0 ? 'HIGH' : index % 3 === 0 ? 'LOW' : 'NORMAL',
    owner,
    workers: [owner, secondWorker],
    remark: `${plot.crop}${PLAN_TITLES[index % PLAN_TITLES.length]}，按绿色防控规程执行`,
    createdAt: formatDateTime(plannedMs - 2 * DAY_MS),
    updatedAt: formatDateTime(plannedMs - 6 * HOUR_MS)
  }
})

const TASK_STATUS_NAMES = {
  PENDING: '待执行',
  DOING: '进行中',
  DONE: '已完成',
  CANCELLED: '已取消',
  OVERDUE: '已逾期'
}

const PLAN_TASK_STATUS = {
  DRAFT: 'PENDING',
  DISPATCHED: 'PENDING',
  DOING: 'DOING',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED'
}

/**
 * 农事工单：与计划一一对应（30 条），派单后由农户执行并打卡（A11/A12）。
 */
export const workOrders = farmPlans.map((plan, index) => {
  const status = PLAN_TASK_STATUS[plan.status] || 'PENDING'
  const plannedMs = parseDateTime(`${plan.planDate} 08:00:00`)
  const finished = status === 'DONE'
  return {
    id: index + 1,
    taskNo: makeNo('WO', index + 1, formatDate(plannedMs).slice(0, 7).replace(/-/g, '')),
    planId: plan.id,
    planNo: plan.planNo,
    title: plan.title,
    plotId: plan.plotId,
    plotName: plan.plotName,
    crop: plan.crop,
    assignee: plan.workers[0],
    assigneePhone: `138****${String(1000 + index).slice(-4)}`,
    status,
    statusName: TASK_STATUS_NAMES[status],
    plannedAt: formatDateTime(plannedMs),
    checkinAt: status === 'DOING' || finished ? formatDateTime(plannedMs + 25 * MINUTE_MS) : '',
    finishedAt: finished ? formatDateTime(plannedMs + 3 * HOUR_MS) : '',
    checkinLocation: `${plan.plotName}东侧入口`,
    content: `按《${plan.title}作业规程》完成，拍照留存`,
    createdAt: plan.createdAt
  }
})

const SUPPLY_CATEGORY_NAMES = {
  FERTILIZER: '肥料',
  PESTICIDE: '农药',
  SEED: '种子种苗',
  OTHER: '其他物资'
}

// 农资库存种子：[名称, 类别, 规格, 单位, 当前数量, 安全库存, 单价, 供应商, 仓库]
const SUPPLY_SEEDS = [
  [
    '复合肥（15-15-15）',
    'FERTILIZER',
    '50kg/袋',
    '袋',
    120,
    30,
    168,
    '江苏苏农农资集团',
    'A 区农资库'
  ],
  ['尿素（46%）', 'FERTILIZER', '50kg/袋', '袋', 24, 25, 132, '江苏苏农农资集团', 'A 区农资库'],
  ['硫酸钾', 'FERTILIZER', '25kg/袋', '袋', 46, 15, 96, '南京绿丰农资有限公司', 'A 区农资库'],
  ['过磷酸钙', 'FERTILIZER', '40kg/袋', '袋', 18, 10, 62, '南京绿丰农资有限公司', 'A 区农资库'],
  ['商品有机肥', 'FERTILIZER', '40kg/袋', '袋', 86, 20, 45, '南京沃土有机肥厂', 'B 区原料库'],
  ['水溶肥（20-20-20）', 'FERTILIZER', '5kg/袋', '袋', 52, 12, 88, '上海芳甸生物', 'B 区原料库'],
  ['吡虫啉可湿性粉剂', 'PESTICIDE', '100g/袋', '袋', 64, 20, 18.5, '南京农科植保站', 'C 区农药库'],
  ['代森锰锌可湿性粉剂', 'PESTICIDE', '500g/袋', '袋', 38, 15, 26, '南京农科植保站', 'C 区农药库'],
  ['嘧霉胺悬浮剂', 'PESTICIDE', '500ml/瓶', '瓶', 12, 15, 42, '江苏辉丰生物', 'C 区农药库'],
  ['阿维菌素乳油', 'PESTICIDE', '200ml/瓶', '瓶', 30, 10, 28, '江苏辉丰生物', 'C 区农药库'],
  ['草铵膦水剂', 'PESTICIDE', '1L/瓶', '瓶', 22, 8, 35, '南京农科植保站', 'C 区农药库'],
  ['枯草芽孢杆菌', 'PESTICIDE', '500g/袋', '袋', 9, 12, 56, '南京沃土有机肥厂', 'C 区农药库'],
  ['番茄种子（金棚 1 号）', 'SEED', '10g/袋', '袋', 40, 10, 120, '北京金棚种业', 'D 区种子库'],
  ['黄瓜种子（津优 35）', 'SEED', '20g/袋', '袋', 26, 8, 95, '天津科润黄瓜研究所', 'D 区种子库'],
  ['辣椒苗（苏椒 5 号）', 'SEED', '50 株/盘', '盘', 60, 20, 45, '江宁育苗中心', 'D 区种子库'],
  ['地膜（黑白双色）', 'OTHER', '10kg/卷', '卷', 14, 6, 118, '山东寿光塑业', 'E 区物资库'],
  ['滴灌带（16mm）', 'OTHER', '500m/卷', '卷', 8, 10, 260, '南京润田节水', 'E 区物资库'],
  ['防虫网（40 目）', 'OTHER', '50m/卷', '卷', 16, 5, 210, '南京润田节水', 'E 区物资库'],
  ['黄板（20×25cm）', 'OTHER', '20 张/包', '包', 35, 15, 32, '南京农科植保站', 'E 区物资库'],
  ['遮阳网（75% 遮光）', 'OTHER', '100m²/卷', '卷', 6, 4, 340, '山东寿光塑业', 'E 区物资库']
]

/**
 * 农资库存：20 条（A13），库存状态由当前数量与安全库存比较得出。
 */
export const supplyItems = SUPPLY_SEEDS.map((seed, index) => {
  const [name, category, spec, unit, quantity, safetyStock, price, supplier, warehouse] = seed
  const status = quantity === 0 ? 'OUT' : quantity <= safetyStock ? 'LOW' : 'NORMAL'
  return {
    id: index + 1,
    code: makeNo('AG', index + 1, '2026'),
    name,
    category,
    categoryName: SUPPLY_CATEGORY_NAMES[category],
    spec,
    unit,
    quantity,
    safetyStock,
    price,
    supplier,
    warehouse,
    status,
    statusName: status === 'OUT' ? '缺货' : status === 'LOW' ? '低库存' : '正常',
    expiryDate: category === 'PESTICIDE' ? formatDate(NOW_MS + (360 + index * 20) * DAY_MS) : '',
    updatedAt: formatDateTime(NOW_MS - (index * 11 + 2) * HOUR_MS)
  }
})

const PESTICIDE_NAMES = [
  '吡虫啉可湿性粉剂',
  '代森锰锌可湿性粉剂',
  '嘧霉胺悬浮剂',
  '阿维菌素乳油',
  '草铵膦水剂',
  '枯草芽孢杆菌'
]

const PESTICIDE_DETAILS = {
  吡虫啉可湿性粉剂: ['吡虫啉 10%', '可湿性粉剂'],
  代森锰锌可湿性粉剂: ['代森锰锌 80%', '可湿性粉剂'],
  嘧霉胺悬浮剂: ['嘧霉胺 40%', '悬浮剂'],
  阿维菌素乳油: ['阿维菌素 1.8%', '乳油'],
  草铵膦水剂: ['草铵膦 200g/L', '水剂'],
  枯草芽孢杆菌: ['枯草芽孢杆菌 1000 亿/g', '可湿性粉剂']
}

/**
 * 农药使用台账：30 条（A14），记录作物、剂量、安全间隔期与操作人，供监管抽查。
 */
export const pesticideLogs = Array.from({ length: 30 }, (_, index) => {
  const plot = plots[index % 4]
  const name = PESTICIDE_NAMES[index % PESTICIDE_NAMES.length]
  const [activeIngredient, formulation] = PESTICIDE_DETAILS[name]
  const appliedMs = NOW_MS - (index * 19 + 4) * HOUR_MS
  const safeIntervalDays = 3 + (index % 4)
  return {
    id: index + 1,
    logNo: makeNo('PS', index + 1, formatDate(appliedMs).replace(/-/g, '')),
    pesticideName: name,
    activeIngredient,
    formulation,
    dilution: `${800 + (index % 5) * 200} 倍液`,
    dose: round(12 + (index % 6) * 3.5, 1),
    unit: 'ml/亩',
    plotId: plot.id,
    plotName: plot.name,
    crop: plot.crop,
    appliedAt: formatDateTime(appliedMs),
    operator: FARMER_NAMES[index % FARMER_NAMES.length],
    deviceCode: `EQ-${(index % 4) + 1}V-${String(((index % 4) + 1) * 5).padStart(4, '0')}`,
    safeIntervalDays,
    withdrawEndDate: formatDate(appliedMs + safeIntervalDays * DAY_MS),
    remark: index % 3 === 0 ? '按绿色防控方案轮换用药' : '',
    createdAt: formatDateTime(appliedMs + 10 * MINUTE_MS)
  }
})

const HARVEST_STATUS_NAMES = {
  PENDING: '待检',
  INSPECTING: '检测中',
  QUALIFIED: '检测合格',
  REJECTED: '检测不合格'
}

/**
 * 采收批次：18 条（A15），每个批次关联地块、等级、数量与质检状态。
 */
export const harvestBatches = Array.from({ length: 18 }, (_, index) => {
  const plot = plots[index % 4]
  const harvestMs = NOW_MS - (index * 20 + 5) * HOUR_MS
  const status = ['QUALIFIED', 'INSPECTING', 'PENDING', 'QUALIFIED', 'REJECTED'][index % 5]
  return {
    id: index + 1,
    batchNo: makeNo('HB', index + 1, formatDate(harvestMs).replace(/-/g, '')),
    plotId: plot.id,
    plotName: plot.name,
    crop: plot.crop,
    variety: plot.variety,
    harvestDate: formatDate(harvestMs),
    quantityKg: round(320 + index * 47.5 + (index % 4) * 30, 1),
    grade: ['特级', '一级', '二级'][index % 3],
    unitPrice: round(6.5 + (index % 5) * 1.8, 2),
    operator: FARMER_NAMES[index % FARMER_NAMES.length],
    status,
    statusName: HARVEST_STATUS_NAMES[status],
    traceCodeCount: 3 + (index % 4),
    remark: index % 6 === 0 ? '雨后采摘，已做预冷处理' : '',
    createdAt: formatDateTime(harvestMs + 30 * MINUTE_MS)
  }
})

/**
 * 溯源码：18 条（A16），与采收批次一一对应，含扫码次数与作废状态。
 */
export const traceCodes = harvestBatches.map((batch, index) => ({
  id: index + 1,
  code: `TRC-2026-${String(index + 1).padStart(6, '0')}`,
  batchId: batch.id,
  batchNo: batch.batchNo,
  crop: batch.crop,
  plotName: batch.plotName,
  status: index === 16 ? 'VOID' : 'ACTIVE',
  statusName: index === 16 ? '已作废' : '有效',
  scanCount: (index * 13) % 47,
  printed: index % 3 !== 0,
  createdAt: formatDateTime(parseDateTime(batch.harvestDate) + 2 * HOUR_MS),
  expireAt: formatDateTime(parseDateTime(batch.harvestDate) + 180 * DAY_MS)
}))

const INSPECTION_ITEMS = [
  { name: '毒死蜱', unit: 'mg/kg', limit: 0.02, base: 0.006 },
  { name: '氯氰菊酯', unit: 'mg/kg', limit: 0.5, base: 0.08 },
  { name: '铅（Pb）', unit: 'mg/kg', limit: 0.1, base: 0.02 },
  { name: '镉（Cd）', unit: 'mg/kg', limit: 0.05, base: 0.008 },
  { name: '亚硝酸盐', unit: 'mg/kg', limit: 4, base: 0.9 }
]

const INSPECTION_CONCLUSION_NAMES = { PASS: '合格', FAIL: '不合格' }

/**
 * 检测报告：12 条（A18），每条包含 5 项农残/重金属指标，结论 PASS / FAIL。
 */
export const inspections = Array.from({ length: 12 }, (_, index) => {
  const batch = harvestBatches[index % harvestBatches.length]
  const conclusion = index % 7 === 3 ? 'FAIL' : 'PASS'
  const inspectedMs = parseDateTime(`${batch.harvestDate} 09:00:00`) + DAY_MS
  const items = INSPECTION_ITEMS.map((item, itemIndex) => {
    const exceeded = conclusion === 'FAIL' && itemIndex === 0
    const value = round(
      item.base + (index % 4) * item.base * 0.3 + (exceeded ? item.limit * 1.4 : 0),
      3
    )
    return {
      name: item.name,
      value,
      limit: item.limit,
      unit: item.unit,
      result: value > item.limit ? '不合格' : '合格'
    }
  })
  return {
    id: index + 1,
    reportNo: makeNo('JC', index + 1, '2026'),
    batchId: batch.id,
    batchNo: batch.batchNo,
    sampleName: `${batch.crop}（${batch.batchNo}）`,
    sampleSource: batch.plotName,
    inspectItems: items,
    conclusion,
    conclusionName: INSPECTION_CONCLUSION_NAMES[conclusion],
    inspector: ['周晓峰', '吴敏', '郑海涛'][index % 3],
    lab: '南京市农产品质量检测中心',
    inspectedAt: formatDateTime(inspectedMs),
    reportUrl: `https://cdn.agri.example.com/reports/${batch.batchNo}.pdf`,
    createdAt: formatDateTime(inspectedMs + 4 * HOUR_MS)
  }
})

// 批次质检状态与检测结论对齐：A15 的 status 不得与 A18 的 conclusion 自相矛盾。
// 有检测报告的批次按报告结论落定（合格→QUALIFIED、不合格→REJECTED）；
// 没有检测报告的批次只能是「待检测 / 检测中」，不能凭空标成合格或不合格。
{
  const reportedBatchNos = new Set(inspections.map((item) => item.batchNo))
  const conclusionByBatch = new Map(inspections.map((item) => [item.batchNo, item.conclusion]))
  harvestBatches.forEach((batch, index) => {
    if (reportedBatchNos.has(batch.batchNo)) {
      batch.status = conclusionByBatch.get(batch.batchNo) === 'FAIL' ? 'REJECTED' : 'QUALIFIED'
    } else if (batch.status === 'QUALIFIED' || batch.status === 'REJECTED') {
      batch.status = index % 2 === 0 ? 'PENDING' : 'INSPECTING'
    }
    batch.statusName = HARVEST_STATUS_NAMES[batch.status]
  })
}

const GOODS_CATEGORY_NAMES = {
  VEGETABLE: '蔬菜',
  FRUIT: '水果',
  GRAIN: '粮油',
  MEDICINE: '中药材'
}

// 商品档案：[名称, 类别, 规格, 单位, 单价, 库存]
const GOODS_SEEDS = [
  ['番茄', 'VEGETABLE', '5kg/箱', '箱', 45, 320],
  ['黄瓜', 'VEGETABLE', '5kg/箱', '箱', 38, 180],
  ['辣椒', 'VEGETABLE', '2.5kg/袋', '袋', 22, 150],
  ['草莓', 'FRUIT', '2.5kg/礼盒', '盒', 128, 60],
  ['苹果', 'FRUIT', '10kg/箱', '箱', 96, 240],
  ['大米', 'GRAIN', '10kg/袋', '袋', 68, 500],
  ['金银花（干花）', 'MEDICINE', '500g/罐', '罐', 168, 80],
  ['番茄礼盒', 'VEGETABLE', '7.5kg/礼盒', '盒', 198, 40]
]

/**
 * 商品档案：8 条（A24），供订单选择与产销看板展示。
 */
export const goodsList = GOODS_SEEDS.map((seed, index) => {
  const [name, category, spec, unit, price, stock] = seed
  return {
    id: index + 1,
    code: makeNo('SP', index + 1, '2026'),
    name,
    category,
    categoryName: GOODS_CATEGORY_NAMES[category],
    spec,
    unit,
    price,
    stock,
    status: index === 6 ? 'OFF_SHELF' : 'ON_SALE',
    statusName: index === 6 ? '已下架' : '在售',
    salesCount: 120 + index * 37,
    createdAt: formatDateTime(NOW_MS - (index + 3) * 10 * DAY_MS)
  }
})

const CUSTOMER_SEEDS = [
  ['南京鲜果多商贸有限公司', '周敏', '13805170021', '南京市建邺区应天大街 188 号', 'VIP'],
  ['苏果超市（江宁店）', '徐磊', '13905190032', '南京市江宁区双龙大道 1222 号', 'VIP'],
  ['盒马鲜生南京仓', '钱程', '13705180043', '南京市雨花台区软件大道 66 号', 'NORMAL'],
  ['南京农副产品物流中心', '孙浩', '13605160054', '南京市江宁区众彩物流园 B 区', 'VIP'],
  ['常州绿源果蔬批发部', '吴倩', '13585290065', '常州市钟楼区凌家塘市场 12 号', 'NORMAL'],
  ['上海叮咚买菜', '李楠', '13612340076', '上海市浦东新区张江路 88 号', 'VIP'],
  ['镇江味好果蔬店', '王芳', '13852980087', '镇江市京口区解放路 45 号', 'NORMAL'],
  ['南京大学后勤集团', '陈立', '13951680098', '南京市栖霞区仙林大道 163 号', 'NORMAL']
]

/**
 * 客户档案：8 条（A24），含等级、累计成交额与订单数。
 */
export const customers = CUSTOMER_SEEDS.map((seed, index) => {
  const [name, contact, phone, address, level] = seed
  return {
    id: index + 1,
    code: makeNo('CUS', index + 1, '2026'),
    name,
    contact,
    phone,
    address,
    level,
    levelName: level === 'VIP' ? '重点客户' : '普通客户',
    orderCount: 3 + (index % 9),
    totalAmount: round(8600 + index * 3270.5, 2),
    status: 'ENABLED',
    createdAt: formatDateTime(NOW_MS - (index + 2) * 20 * DAY_MS)
  }
})

const ORDER_STATUS_NAMES = {
  PENDING: '待付款',
  PAID: '待发货',
  SHIPPED: '已发货',
  DONE: '已完成',
  CANCELLED: '已取消'
}

/**
 * 销售订单：24 条（A23），每条 1~2 个商品明细，金额由明细汇总得出。
 */
export const orders = Array.from({ length: 24 }, (_, index) => {
  const customer = customers[index % customers.length]
  const createdMs = NOW_MS - index * 7 * HOUR_MS
  const firstGoods = goodsList[index % goodsList.length]
  const secondGoods = goodsList[(index + 3) % goodsList.length]
  const items = [
    {
      goodsId: firstGoods.id,
      goodsName: firstGoods.name,
      spec: firstGoods.spec,
      unit: firstGoods.unit,
      quantity: 10 + (index % 6) * 5,
      unitPrice: firstGoods.price,
      amount: round((10 + (index % 6) * 5) * firstGoods.price, 2)
    }
  ]
  if (index % 3 === 0) {
    items.push({
      goodsId: secondGoods.id,
      goodsName: secondGoods.name,
      spec: secondGoods.spec,
      unit: secondGoods.unit,
      quantity: 6 + (index % 4) * 3,
      unitPrice: secondGoods.price,
      amount: round((6 + (index % 4) * 3) * secondGoods.price, 2)
    })
  }
  const totalAmount = round(
    items.reduce((sum, item) => sum + item.amount, 0),
    2
  )
  const status = ['PENDING', 'PAID', 'SHIPPED', 'DONE', 'CANCELLED'][index % 5]
  const paid = ['PAID', 'SHIPPED', 'DONE'].includes(status)
  const shipped = ['SHIPPED', 'DONE'].includes(status)
  return {
    id: index + 1,
    orderNo: makeNo('SO', index + 1, formatDate(createdMs).replace(/-/g, '')),
    customerId: customer.id,
    customerName: customer.name,
    contact: customer.contact,
    phone: customer.phone,
    address: customer.address,
    items,
    totalAmount,
    status,
    statusName: ORDER_STATUS_NAMES[status],
    payMethod: ['WECHAT', 'ALIPAY', 'TRANSFER'][index % 3],
    createdAt: formatDateTime(createdMs),
    paidAt: paid ? formatDateTime(createdMs + 40 * MINUTE_MS) : '',
    shippedAt: shipped ? formatDateTime(createdMs + 20 * HOUR_MS) : '',
    logisticsNo: shipped ? `SF${String(100000000000 + index * 7919)}` : '',
    remark: index % 5 === 0 ? '要求冷链配送' : ''
  }
})

// 角色权限码：与文档 docs/frontend-conventions.md 的权限码表保持一致
export const roles = [
  {
    id: 1,
    code: 'ADMIN',
    name: '超级管理员',
    description: '拥有全部菜单与数据权限',
    perms: ['*'],
    dataScope: 'ALL',
    userCount: 1,
    createdAt: '2026-01-06 09:00:00'
  },
  {
    id: 2,
    code: 'OPS',
    name: '运维工程师',
    description: '设备台账、远程控制与控制日志',
    // 页面级 9 条（iot:env:view ... alarm:handle）决定可见菜单，
    // 后三条是按钮级：设备编辑、指令下发、云台控制
    perms: [
      'iot:env:view',
      'iot:device:list',
      'iot:device:detail',
      'iot:patrol:view',
      'iot:video:view',
      'iot:control',
      'ctl:log:view',
      'alarm:view',
      'alarm:handle',
      'iot:device:edit',
      'iot:control:execute',
      'iot:video:control'
    ],
    dataScope: 'ALL',
    userCount: 2,
    createdAt: '2026-01-06 09:10:00'
  },
  {
    id: 3,
    code: 'FARMER',
    name: '基地农户',
    description: '农事执行、采收与溯源登记',
    // 页面级 16 条决定可见菜单；后三条是按钮级：农事记录、采收登记、溯源编辑。
    // 注意不含 farm:plan:view —— 农事计划管理（P015）只对管理员开放，
    // 农户若持有该码会连页面一起可见，与角色矩阵冲突。
    perms: [
      'iot:env:view',
      'iot:history:view',
      'iot:device:detail',
      'iot:control',
      'alarm:view',
      'analysis:overview:view',
      'ai:view',
      'gis:map:view',
      'gis:stats:view',
      'farm:task:view',
      'farm:input:view',
      'farm:inventory:view',
      'farm:harvest:view',
      'trace:batch:view',
      'trace:edit',
      'trace:lab:view',
      'farm:record:write',
      'harvest:write',
      'trace:write'
    ],
    dataScope: 'PLOT',
    userCount: 3,
    createdAt: '2026-01-06 09:20:00'
  },
  {
    id: 4,
    code: 'SUPERVISOR',
    name: '质量监管员',
    description: '检测报告、投入品台账与溯源查看',
    // 页面级 6 条决定可见菜单；后两条是按钮级：检测报告录入、溯源编辑
    perms: [
      'iot:env:view',
      'iot:device:detail',
      'alarm:view',
      'farm:ledger:view',
      'trace:edit',
      'trace:lab:view',
      'inspection:write',
      'trace:write'
    ],
    dataScope: 'ALL',
    userCount: 2,
    createdAt: '2026-01-06 09:30:00'
  }
]

// 用户种子：[账号, 姓名, 角色码, 手机号, 负责地块]
const USER_SEEDS = [
  ['admin', '系统管理员', 'ADMIN', '13800000001', []],
  ['ops01', '李运维', 'OPS', '13800000002', []],
  ['ops02', '王建国', 'OPS', '13800000003', ['PLOT-05', 'PLOT-07']],
  ['farmer01', '张桂芳', 'FARMER', '13800000004', ['PLOT-01', 'PLOT-04']],
  ['farmer02', '刘志强', 'FARMER', '13800000005', ['PLOT-02', 'PLOT-06']],
  ['farmer03', '陈秀兰', 'FARMER', '13800000006', ['PLOT-03', 'PLOT-08']],
  ['supervisor01', '赵敏', 'SUPERVISOR', '13800000007', []],
  ['supervisor02', '孙丽', 'SUPERVISOR', '13800000008', []]
]

/**
 * 用户列表：8 个账号覆盖 4 个角色（A25），perms 由角色带出。
 */
export const users = USER_SEEDS.map((seed, index) => {
  const [username, name, roleCode, phone, plotIds] = seed
  const role = roles.find((item) => item.code === roleCode)
  return {
    id: index + 1,
    username,
    name,
    phone,
    email: `${username}@agri-demo.cn`,
    roleCode,
    roleName: role?.name || '',
    perms: [...(role?.perms || [])],
    plotIds,
    status: index === 7 ? 'DISABLED' : 'ENABLED',
    statusName: index === 7 ? '已停用' : '正常',
    lastLoginAt: formatDateTime(NOW_MS - (index * 3 + 1) * HOUR_MS),
    createdAt: formatDateTime(NOW_MS - (60 + index * 15) * DAY_MS)
  }
})

const MENU_GROUPS = [
  {
    title: '物联网感知监测',
    items: [
      { path: '/iot/env', title: '环境数据监测', pageId: 'P002' },
      { path: '/iot/history', title: '历史数据与趋势', pageId: 'P004' },
      { path: '/iot/devices', title: '设备总览', pageId: 'P005' },
      { path: '/iot/devices/detail', title: '设备详情', pageId: 'P003' },
      { path: '/iot/patrol', title: '设备巡检与离线排查', pageId: 'P006' },
      { path: '/iot/video', title: '视频监控', pageId: 'P013' }
    ]
  },
  {
    title: '远程智能控制',
    items: [
      { path: '/iot/control', title: '远程控制', pageId: 'P007' },
      { path: '/iot/strategy', title: '策略联动配置', pageId: 'P008' },
      { path: '/iot/control/log', title: '控制日志', pageId: 'P009' }
    ]
  },
  {
    title: '数据中心与AI分析',
    items: [
      { path: '/analysis/overview', title: '数据分析总览', pageId: 'P010' },
      { path: '/reports', title: '报表中心', pageId: 'P011' },
      { path: '/analysis/ai', title: '长势与病虫害识别', pageId: 'P012' }
    ]
  },
  {
    title: 'GIS地理信息',
    items: [
      { path: '/gis/map', title: 'GIS 一张图', pageId: 'P014' },
      { path: '/gis/stats', title: '空间统计与图层', pageId: 'P024' }
    ]
  },
  {
    title: '生产农事管理',
    items: [
      { path: '/farm/plans', title: '农事计划管理', pageId: 'P015' },
      { path: '/farm/tasks', title: '农事工单与打卡', pageId: 'P016' },
      { path: '/farm/inputs', title: '农资档案与领用', pageId: 'P017' },
      { path: '/farm/inputs/ledger', title: '出库与投入品台账', pageId: 'P018' },
      { path: '/farm/inputs/inventory', title: '库存与低库存预警', pageId: 'P019' },
      { path: '/farm/harvest', title: '采收批次登记', pageId: 'P020' }
    ]
  },
  {
    title: '质量安全溯源',
    items: [
      { path: '/trace/batches', title: '溯源批次与二维码', pageId: 'P021' },
      { path: '/trace/edit', title: '溯源信息编辑与预览', pageId: 'P022' },
      { path: '/trace/lab', title: '检测报告与送检', pageId: 'P023' }
    ]
  },
  {
    title: '告警消息中心',
    items: [
      { path: '/iot/alerts', title: '告警列表', pageId: 'P025' },
      { path: '/iot/alerts/handle', title: '告警处置与统计', pageId: 'P026' }
    ]
  },
  {
    title: '产销对接与订单',
    items: [
      { path: '/commerce/orders', title: '订单管理', pageId: 'P027' },
      { path: '/commerce/products', title: '商品与客户档案', pageId: 'P028' }
    ]
  },
  {
    title: '系统后台管理',
    items: [
      { path: '/system/users', title: '用户与角色管理', pageId: 'P029' },
      { path: '/system/perm', title: '权限配置与接口对接', pageId: 'P030' }
    ]
  }
]

/**
 * 菜单权限树：结构与 router/menu.js 生成的分组一致，供 A02 返回给前端渲染侧边栏。
 */
export const menuGroups = MENU_GROUPS

/**
 * 控制策略：8 条（A08），覆盖温湿度、土壤墒情、光照与 CO₂ 的自动联动。
 */
export const strategies = [
  ['高温自动通风', 'PLOT-01', 'temperature', '>', 30, 5, 'OPEN_FAN', 'CRITICAL'],
  ['低温自动加温', 'PLOT-01', 'temperature', '<', 15, 10, 'OPEN_HEATER', 'MAJOR'],
  ['湿度超限放风', 'PLOT-02', 'humidity', '>', 88, 5, 'OPEN_FAN', 'MAJOR'],
  ['土壤缺水灌溉', 'PLOT-03', 'soilMoisture', '<', 20, 15, 'OPEN_VALVE', 'MAJOR'],
  ['光照不足补光', 'PLOT-04', 'light', '<', 6000, 20, 'OPEN_LIGHT', 'MINOR'],
  ['CO₂ 偏低补气', 'PLOT-02', 'co2', '<', 380, 10, 'OPEN_CO2', 'MINOR'],
  ['夜间降温排湿', 'PLOT-01', 'humidity', '>', 85, 30, 'OPEN_FAN', 'MINOR'],
  ['大田干旱预警', 'PLOT-05', 'soilMoisture', '<', 16, 60, 'SEND_ALARM', 'MAJOR']
].map((seed, index) => {
  const [name, plotId, metric, operator, threshold, duration, action, level] = seed
  const plot = findPlot(plotId)
  return {
    id: index + 1,
    strategyNo: makeNo('STG', index + 1, '2026'),
    name,
    plotId,
    plotName: plot?.name || '',
    deviceType:
      metric === 'soilMoisture'
        ? 'SM'
        : metric === 'co2'
          ? 'CO2'
          : metric === 'light'
            ? 'LUX'
            : 'TH',
    metric,
    metricName:
      {
        temperature: '空气温度',
        humidity: '空气湿度',
        soilMoisture: '土壤含水率',
        light: '光照强度',
        co2: 'CO₂ 浓度'
      }[metric] || metric,
    operator,
    threshold,
    duration,
    action,
    actionName:
      {
        OPEN_FAN: '开启风机',
        OPEN_HEATER: '开启加温',
        OPEN_VALVE: '开启灌溉',
        OPEN_LIGHT: '开启补光',
        OPEN_CO2: '开启补气',
        SEND_ALARM: '仅推送告警'
      }[action] || action,
    level,
    enabled: index !== 6,
    priority: index + 1,
    createdAt: formatDateTime(NOW_MS - (index + 5) * DAY_MS),
    updatedAt: formatDateTime(NOW_MS - (index + 1) * DAY_MS)
  }
})

/**
 * 控制日志：40 条（A09），与指令下发记录对应，含执行结果与操作人。
 */
export const controlLogs = Array.from({ length: 40 }, (_, index) => {
  const device = devices[(index * 3) % devices.length]
  const createdMs = NOW_MS - (index * 53 + 8) * MINUTE_MS
  const success = index % 9 !== 4
  return {
    id: index + 1,
    logNo: makeNo('CL', index + 1, formatDate(createdMs).replace(/-/g, '')),
    requestId: `REQ-${formatDate(createdMs).replace(/-/g, '')}-${String(index + 1).padStart(4, '0')}`,
    deviceCode: device.code,
    deviceName: device.name,
    plotName: device.plotName,
    action: ['ON', 'OFF', 'OPEN', 'CLOSE'][index % 4],
    actionName: ['开机', '停机', '开启', '关闭'][index % 4],
    operator: STAFF_NAMES[index % STAFF_NAMES.length],
    source: index % 4 === 0 ? 'STRATEGY' : 'MANUAL',
    sourceName: index % 4 === 0 ? '策略联动' : '人工下发',
    status: success ? 'SUCCESS' : 'FAILED',
    statusName: success ? '执行成功' : '执行失败',
    result: success ? '设备已响应并反馈' : '设备超时未反馈',
    createdAt: formatDateTime(createdMs),
    finishedAt: formatDateTime(createdMs + 12 * 1000)
  }
})

const DIAGNOSIS_TYPE_NAMES = {
  GROWTH: '长势分析',
  PEST: '虫害识别',
  DISEASE: '病害识别'
}

// 诊断结论模板：按地块轮换，保证同一地块多次诊断的结论稳定
const DIAGNOSIS_RESULTS = [
  {
    diagnosisType: 'GROWTH',
    conclusion: '长势良好，叶面积指数 3.2，处于适宜区间',
    advice: '维持当前水肥节奏，7 天后复查一次'
  },
  {
    diagnosisType: 'PEST',
    conclusion: '检测到少量蚜虫（置信度 0.91），未达到防治阈值',
    advice: '释放瓢虫进行生物防治，3 天后复查虫口密度'
  },
  {
    diagnosisType: 'DISEASE',
    conclusion: '下部叶片疑似早疫病初期，病斑占比 6%',
    advice: '及时摘除病叶并喷施代森锰锌，注意安全间隔期'
  },
  {
    diagnosisType: 'GROWTH',
    conclusion: '植株略徒长，节间偏长，需控旺',
    advice: '降低夜温 1~2℃，减少氮肥用量'
  }
]

/**
 * AI 诊断记录：12 条（A21），结论由地块与序号决定，含置信度与处置建议。
 */
export const aiDiagnoses = Array.from({ length: 12 }, (_, index) => {
  const plot = plots[index % plots.length]
  const template = DIAGNOSIS_RESULTS[index % DIAGNOSIS_RESULTS.length]
  const createdMs = NOW_MS - (index * 9 + 2) * HOUR_MS
  return {
    id: index + 1,
    diagnosisNo: makeNo('AI', index + 1, formatDate(createdMs).replace(/-/g, '')),
    plotId: plot.id,
    plotName: plot.name,
    crop: plot.crop,
    diagnosisType: template.diagnosisType,
    diagnosisTypeName: DIAGNOSIS_TYPE_NAMES[template.diagnosisType],
    imageUrl: `https://cdn.agri.example.com/diagnosis/${formatDate(createdMs).replace(/-/g, '')}/${String(index + 1).padStart(3, '0')}.jpg`,
    conclusion: template.conclusion,
    advice: template.advice,
    confidence: round(0.86 + (index % 5) * 0.025, 3),
    status: 'DONE',
    statusName: '已完成',
    operator: STAFF_NAMES[index % STAFF_NAMES.length],
    createdAt: formatDateTime(createdMs)
  }
})

const REPORT_TYPE_NAMES = {
  YIELD: '产量分析',
  INPUT: '投入品分析',
  ALARM: '告警分析',
  TRACE: '溯源分析',
  TRADE: '产销分析'
}

// 报表模板：报表中心（A22）预置 6 份已生成报表
const REPORT_SEEDS = [
  ['11 月设施蔬菜产量月报', 'YIELD', '2026-11'],
  ['设施番茄投入产出分析', 'INPUT', '2026-11'],
  ['告警处置周报（第 46 周）', 'ALARM', '2026-11-09~2026-11-15'],
  ['溯源码使用情况统计', 'TRACE', '2026-11'],
  ['农资消耗季度报表', 'INPUT', '2026Q4'],
  ['订单与回款月报', 'TRADE', '2026-11']
]

/**
 * 报表记录：6 条（A22），只存元信息；图表聚合数据由 POST /reports 或详情接口实时计算。
 */
export const reports = REPORT_SEEDS.map((seed, index) => {
  const [name, type, period] = seed
  return {
    id: index + 1,
    reportNo: makeNo('RP', index + 1, period.replace(/[^\d]/g, '').slice(0, 6)),
    name,
    type,
    typeName: REPORT_TYPE_NAMES[type],
    period,
    status: 'READY',
    statusName: '已生成',
    createdAt: formatDateTime(NOW_MS - (index * 26 + 3) * HOUR_MS),
    createdBy: '系统管理员'
  }
})

/**
 * 开放平台应用：3 个（A26），含 appId、appSecret、授权范围。
 */
export const openApps = [
  {
    id: 1,
    appId: 'APP-2026-0001',
    appName: '南京市农业农村局监管平台',
    appSecret: 'sec_agri_9f2c71',
    status: 'ENABLED',
    statusName: '已启用',
    scopes: ['trace:read', 'inspection:read'],
    createdAt: '2026-03-12 10:00:00',
    lastAccessAt: formatDateTime(NOW_MS - 2 * HOUR_MS)
  },
  {
    id: 2,
    appId: 'APP-2026-0002',
    appName: '苏果超市溯源查询小程序',
    appSecret: 'sec_agri_4b8d20',
    status: 'ENABLED',
    statusName: '已启用',
    scopes: ['trace:read'],
    createdAt: '2026-05-20 14:30:00',
    lastAccessAt: formatDateTime(NOW_MS - 26 * HOUR_MS)
  },
  {
    id: 3,
    appId: 'APP-2026-0003',
    appName: '第三方气象服务（联调中）',
    appSecret: 'sec_agri_71ae55',
    status: 'DISABLED',
    statusName: '已停用',
    scopes: ['iot:read'],
    createdAt: '2026-09-01 09:15:00',
    lastAccessAt: ''
  }
]

/**
 * 运行态：写接口产生的内存副作用。
 * 刷新页面（重新加载模块）后自动复位，不会污染种子数据的初始值。
 */
export const runtime = {
  // 安全锁：开启后所有远程控制下发都被拒绝（返回 42301）
  safetyLock: false,
  // 指令序号，用于生成 commandId
  commandSequence: 0,
  // requestId -> 指令对象；A05 查询时读取并推进状态
  commands: new Map(),
  // 已受理过的 requestId，用于幂等判重（返回 40901）
  requestIds: new Set(),
  // 已打卡的工单键（taskId + 日期），用于重复打卡判重（返回 40901）
  checkinKeys: new Set(),
  // 农事打卡记录（A12 写入）
  farmRecords: [],
  // 出入库流水（A13 写入）
  stockLogs: []
}

/**
 * 切换安全锁状态，供演示 42301 错误场景。
 * @param {boolean} value 是否开启
 * @returns {boolean} 切换后的状态
 */
export function setSafetyLock(value) {
  runtime.safetyLock = Boolean(value)
  return runtime.safetyLock
}

/**
 * 复位运行态，保证自检脚本多次执行时互不影响。
 * @returns {void}
 */
export function resetRuntime() {
  runtime.safetyLock = false
  runtime.commandSequence = 0
  runtime.commands.clear()
  runtime.requestIds.clear()
  runtime.checkinKeys.clear()
  runtime.farmRecords.length = 0
  runtime.stockLogs.length = 0
}

/**
 * 按编号或名称查找地块。
 * @param {string} value 地块 id / code / 名称
 * @returns {Object|null} 地块对象
 */
export function findPlot(value) {
  const key = String(value ?? '').trim()
  if (!key) {
    return null
  }
  return plots.find((item) => item.id === key || item.code === key || item.name === key) || null
}

/**
 * 按设备编码查找设备。
 * @param {string} code 设备编码
 * @returns {Object|null} 设备对象
 */
export function findDevice(code) {
  const key = String(code ?? '').trim()
  if (!key) {
    return null
  }
  return devices.find((item) => item.code === key || String(item.id) === key) || null
}

/**
 * 按 id 或告警编号查找告警。
 * @param {string|number} value 告警 id / alarmNo
 * @returns {Object|null} 告警对象
 */
export function findAlarm(value) {
  return (
    alarms.find(
      (item) => String(item.id) === String(value) || item.alarmNo === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 id 或计划编号查找农事计划。
 * @param {string|number} value 计划 id / planNo
 * @returns {Object|null} 计划对象
 */
export function findPlan(value) {
  return (
    farmPlans.find(
      (item) => String(item.id) === String(value) || item.planNo === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 id 或工单编号查找农事工单。
 * @param {string|number} value 工单 id / taskNo
 * @returns {Object|null} 工单对象
 */
export function findWorkOrder(value) {
  return (
    workOrders.find(
      (item) => String(item.id) === String(value) || item.taskNo === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 id 或编码查找农资。
 * @param {string|number} value 农资 id / code
 * @returns {Object|null} 农资对象
 */
export function findSupplyItem(value) {
  return (
    supplyItems.find(
      (item) => String(item.id) === String(value) || item.code === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 id 或批次号查找采收批次。
 * @param {string|number} value 批次 id / batchNo
 * @returns {Object|null} 批次对象
 */
export function findHarvestBatch(value) {
  return (
    harvestBatches.find(
      (item) => String(item.id) === String(value) || item.batchNo === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按溯源码查找。
 * @param {string} code 溯源码
 * @returns {Object|null} 溯源码对象
 */
export function findTraceCode(code) {
  return traceCodes.find((item) => item.code === String(code ?? '').trim()) || null
}

/**
 * 按账号或 id 查找用户。
 * @param {string|number} value 账号 / 用户 id
 * @returns {Object|null} 用户对象
 */
export function findUser(value) {
  const key = String(value ?? '').trim()
  return users.find((item) => item.username === key || String(item.id) === key) || null
}

/**
 * 按角色码或 id 查找角色。
 * @param {string|number} value 角色码 / 角色 id
 * @returns {Object|null} 角色对象
 */
export function findRole(value) {
  const key = String(value ?? '').trim()
  return roles.find((item) => item.code === key || String(item.id) === key) || null
}

/**
 * 按 id 或商品编码查找商品。
 * @param {string|number} value 商品 id / code
 * @returns {Object|null} 商品对象
 */
export function findGoods(value) {
  return (
    goodsList.find(
      (item) => String(item.id) === String(value) || item.code === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 id 或客户编码查找客户。
 * @param {string|number} value 客户 id / code
 * @returns {Object|null} 客户对象
 */
export function findCustomer(value) {
  return (
    customers.find(
      (item) => String(item.id) === String(value) || item.code === String(value ?? '').trim()
    ) || null
  )
}

/**
 * 按 appId 查找开放平台应用。
 * @param {string} appId 应用编号
 * @returns {Object|null} 应用对象
 */
export function findApp(appId) {
  return openApps.find((item) => item.appId === String(appId ?? '').trim()) || null
}

/**
 * 按 id 查找 AI 诊断记录。
 * @param {string|number} value 诊断 id
 * @returns {Object|null} 诊断对象
 */
export function findDiagnosis(value) {
  return aiDiagnoses.find((item) => String(item.id) === String(value)) || null
}

/**
 * 按 id 或报表编号查找报表。
 * @param {string|number} value 报表 id / reportNo
 * @returns {Object|null} 报表对象
 */
export function findReport(value) {
  const key = String(value ?? '').trim()
  return reports.find((item) => String(item.id) === key || item.reportNo === key) || null
}

/**
 * 报表类型名称，供 A22 校验与回显。
 * @param {string} type 报表类型
 * @returns {string} 中文名称
 */
export function reportTypeName(type) {
  return REPORT_TYPE_NAMES[type] || ''
}
