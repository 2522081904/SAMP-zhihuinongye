/**
 * mock 层通用工具
 * 职责：统一响应信封、分页计算、路径匹配、请求上下文解析与时间格式化。
 * 约束：本文件不引用 Vite 专有 API（如 import.meta.env），也不引用浏览器对象，
 *       因此可以被 Node 直接 import（scripts/mock-smoke.mjs 依赖这一点）。
 */

// 业务时区固定为东八区：种子数据与接口时间都按北京时间输出，避免受运行环境时区影响
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000

// 分页默认值与上限（契约：page 从 1 开始，size 默认 10、上限 100）
export const DEFAULT_PAGE_SIZE = 10
export const MAX_PAGE_SIZE = 100

// 响应 requestId 的自增序号，保证同毫秒内多次调用也能区分
let requestSeed = 0

/**
 * 补零
 * @param {number} value 数值
 * @returns {string} 两位字符串
 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 解析 `yyyy-MM-dd HH:mm:ss` / `yyyy-MM-dd` 为时间戳（按东八区解释）。
 * @param {string|number|Date} text 时间文本
 * @returns {number} 毫秒时间戳，无法解析时返回 NaN
 */
export function parseDateTime(text) {
  if (text instanceof Date) {
    return text.getTime()
  }
  if (typeof text === 'number') {
    return text
  }
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    String(text ?? '').trim()
  )
  if (!matched) {
    return NaN
  }
  return (
    Date.UTC(
      Number(matched[1]),
      Number(matched[2]) - 1,
      Number(matched[3]),
      Number(matched[4] || 0),
      Number(matched[5] || 0),
      Number(matched[6] || 0)
    ) - TZ_OFFSET_MS
  )
}

/**
 * 把时间戳格式化为 `yyyy-MM-dd HH:mm:ss`（东八区）。
 * @param {number|string} value 时间戳或可解析的时间文本
 * @returns {string} 时间文本，无法解析时返回空串
 */
export function formatDateTime(value) {
  const ms = typeof value === 'number' ? value : parseDateTime(value)
  if (!Number.isFinite(ms)) {
    return ''
  }
  const date = new Date(ms + TZ_OFFSET_MS)
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  )
}

/**
 * 只取日期部分 `yyyy-MM-dd`。
 * @param {number|string} value 时间戳或可解析的时间文本
 * @returns {string} 日期文本
 */
export function formatDate(value) {
  return formatDateTime(value).slice(0, 10)
}

/**
 * 取东八区的年月日时分，供时序数据按小时生成波形。
 * @param {number} ms 时间戳
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, weekday: number}}
 */
export function beijingParts(ms) {
  const date = new Date(ms + TZ_OFFSET_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    weekday: date.getUTCDay()
  }
}

/**
 * 构造统一响应信封 `{ code, message, data, requestId, timestamp }`。
 * @param {number} code 业务码
 * @param {string} message 提示文案
 * @param {*} data 业务数据
 * @returns {Object} 响应信封
 */
function buildEnvelope(code, message, data) {
  requestSeed = (requestSeed + 1) % 100000
  return {
    code,
    message,
    data,
    requestId: `REQ-${Date.now().toString(36).toUpperCase()}-${String(requestSeed).padStart(4, '0')}`,
    timestamp: formatDateTime(Date.now())
  }
}

/**
 * 成功信封（code = 0）
 * @param {*} data 业务数据
 * @param {string} message 提示文案
 * @returns {Object} 响应信封
 */
export function ok(data = null, message = '操作成功') {
  return buildEnvelope(0, message, data)
}

/**
 * 失败信封
 * @param {number} code 统一错误码
 * @param {string} message 提示文案
 * @param {*} data 附加数据
 * @returns {Object} 响应信封
 */
export function fail(code, message, data = null) {
  return buildEnvelope(code, message, data)
}

/**
 * 归一化分页参数：非法页码回落到 1，非法条数回落到 10，超过 100 截断为 100。
 * @param {Object} params 查询参数
 * @returns {{page: number, size: number}} 页码与条数
 */
export function normalizePaging(params = {}) {
  const rawPage = Number.parseInt(params.page, 10)
  const rawSize = Number.parseInt(params.size, 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const size =
    Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE
  return { page, size }
}

/**
 * 对已过滤的数组做内存分页。
 * @param {Array} list 已过滤的完整列表
 * @param {Object} params 查询参数（取 page / size）
 * @returns {{page: number, size: number, total: number, list: Array}} 分页结构
 */
export function paginate(list = [], params = {}) {
  const { page, size } = normalizePaging(params)
  const start = (page - 1) * size
  return {
    page,
    size,
    total: list.length,
    list: list.slice(start, start + size)
  }
}

/**
 * 拆分路径为段，忽略空段。
 * @param {string} value 路径
 * @returns {Array<string>} 路径段
 */
function splitSegments(value) {
  return String(value || '')
    .split('/')
    .filter(Boolean)
}

/**
 * 安全解码，避免非法百分号编码抛异常。
 * @param {string} value 路径段
 * @returns {string} 解码结果
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 路径匹配，支持 `:name` 形式的路径参数。
 * 例：matchPath('/iot/devices/EQ-1T-0001', '/iot/devices/:code') → { code: 'EQ-1T-0001' }
 * @param {string} path 实际路径（不含查询串）
 * @param {string} pattern 路由模板
 * @returns {Object|null} 路径参数对象；不匹配时返回 null
 */
export function matchPath(path, pattern) {
  const pathSegments = splitSegments(path)
  const patternSegments = splitSegments(pattern)
  if (pathSegments.length !== patternSegments.length) {
    return null
  }
  const params = {}
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index]
    if (segment.startsWith(':')) {
      if (!pathSegments[index]) {
        return null
      }
      params[segment.slice(1)] = safeDecode(pathSegments[index])
    } else if (segment !== pathSegments[index]) {
      return null
    }
  }
  return params
}

/**
 * 读取查询参数中的单个值（数组取第一项）。
 * @param {Object} query 查询参数对象
 * @param {string} key 参数名
 * @returns {string} 参数值
 */
export function queryValue(query, key) {
  const raw = query?.[key]
  if (Array.isArray(raw)) {
    return String(raw[0] ?? '').trim()
  }
  return String(raw ?? '').trim()
}

/**
 * 判断文本是否为空。
 * @param {*} value 任意值
 * @returns {boolean} 是否为空
 */
export function isBlank(value) {
  return String(value ?? '').trim() === ''
}

/**
 * 关键字模糊匹配：命中任意字段即视为匹配。
 * @param {Array} fields 参与匹配的字段值
 * @param {string} keyword 关键字
 * @returns {boolean} 是否匹配
 */
export function matchKeyword(fields, keyword) {
  const kw = String(keyword || '')
    .trim()
    .toLowerCase()
  if (!kw) {
    return true
  }
  return fields.some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(kw)
  )
}

/**
 * 时间区间过滤：from / to 均可缺省，闭区间。
 * @param {string} timeText 待比较的时间文本
 * @param {string} from 起始时间
 * @param {string} to 结束时间
 * @returns {boolean} 是否落在区间内
 */
export function inTimeRange(timeText, from, to) {
  const current = parseDateTime(timeText)
  if (!Number.isFinite(current)) {
    return false
  }
  const fromMs = parseDateTime(from)
  const toMs = parseDateTime(to)
  if (Number.isFinite(fromMs) && current < fromMs) {
    return false
  }
  if (Number.isFinite(toMs) && current > toMs) {
    return false
  }
  return true
}

/**
 * 数值保留小数位。
 * @param {number} value 数值
 * @param {number} digits 小数位
 * @returns {number} 处理后的数值
 */
export function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 解析整数，失败时返回默认值。
 * @param {*} value 原始值
 * @param {number} fallback 默认值
 * @returns {number} 整数
 */
export function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 生成业务编号，如 `PL-202611-001`。
 * @param {string} prefix 前缀
 * @param {number} sequence 序号
 * @param {string} middle 中段（日期等）
 * @returns {string} 业务编号
 */
export function makeNo(prefix, sequence, middle = '') {
  const seq = String(sequence).padStart(3, '0')
  return middle ? `${prefix}-${middle}-${seq}` : `${prefix}-${seq}`
}

/**
 * 统一延时，用于模拟网络耗时。
 * @param {number} ms 毫秒
 * @returns {Promise<void>} 延时 Promise
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
