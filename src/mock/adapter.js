/**
 * 自实现 axios mock adapter
 * 不依赖 axios-mock-adapter：按 method + path 匹配本地注册表，返回统一响应信封。
 * 未匹配的请求返回 HTTP 200 + 业务码 40401 的信封，便于沿用 request.js 的 code 判断逻辑。
 */
import { fail, sleep } from './utils.js'
import { handleAuth } from './handlers/auth.js'
import { handleIot } from './handlers/iot.js'
import { handleCtl } from './handlers/ctl.js'
import { handleGis } from './handlers/gis.js'
import { handleFarm } from './handlers/farm.js'
import { handleSupply } from './handlers/supply.js'
import { handleHarvest } from './handlers/harvest.js'
import { handleTrace } from './handlers/trace.js'
import { handleAlarm } from './handlers/alarm.js'
import { handleAnalysis } from './handlers/analysis.js'
import { handleTrade } from './handlers/trade.js'
import { handleSystem } from './handlers/system.js'
import { handleOpen } from './handlers/open.js'

// 处理器注册表：按模块拆分，顺序即匹配顺序
const MODULE_HANDLERS = [
  handleAuth,
  handleIot,
  handleCtl,
  handleGis,
  handleFarm,
  handleSupply,
  handleHarvest,
  handleTrace,
  handleAlarm,
  handleAnalysis,
  handleTrade,
  handleSystem,
  handleOpen
]

// 接口前缀，axios 实例的 baseURL 会拼接该前缀，adapter 内需剥离后再匹配
const API_PREFIX = '/api/v1'

/**
 * 归一化请求头：兼容 AxiosHeaders 实例与普通对象，键统一小写。
 * @param {Object} rawHeaders axios 请求头
 * @returns {Object} 小写键的普通对象
 */
function normalizeHeaders(rawHeaders) {
  const source =
    rawHeaders && typeof rawHeaders.toJSON === 'function' ? rawHeaders.toJSON() : rawHeaders || {}
  const headers = {}
  Object.entries(source).forEach(([key, value]) => {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  })
  return headers
}

/**
 * 解析请求地址，分离路径与查询串，并剥离 /api/v1 前缀。
 * @param {Object} config axios 请求配置
 * @returns {{path: string, query: Object}} 路径与查询参数
 */
function parseUrl(config) {
  const rawUrl = String(config.url || '')
  // 兼容绝对地址（例如直接配置了完整 URL）
  const withoutOrigin = rawUrl.replace(/^[a-z]+:\/\/[^/]+/i, '')
  const [rawPath, rawQuery = ''] = withoutOrigin.split('?')
  let path = rawPath || '/'
  if (path.startsWith(API_PREFIX)) {
    path = path.slice(API_PREFIX.length) || '/'
  }
  const query = {
    ...(config.params && typeof config.params === 'object' ? config.params : {})
  }
  if (rawQuery) {
    new URLSearchParams(rawQuery).forEach((value, key) => {
      query[key] = value
    })
  }
  return { path, query }
}

/**
 * 解析请求体：axios 默认把对象序列化为 JSON 字符串。
 * @param {*} data 请求体
 * @returns {Object} 解析后的对象
 */
function parseBody(data) {
  if (!data) {
    return {}
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return {}
    }
  }
  return data
}

/**
 * 归一化 axios 配置为处理器可直接使用的请求上下文。
 * @param {Object} config axios 请求配置
 * @returns {Object} { method, path, query, body, headers }
 */
export function normalizeConfig(config) {
  const { path, query } = parseUrl(config)
  return {
    method: String(config.method || 'GET').toUpperCase(),
    path,
    query,
    body: parseBody(config.data),
    headers: normalizeHeaders(config.headers)
  }
}

/**
 * 按注册表分发请求；所有异常统一转为 50001 信封，保证页面不会白屏。
 * 之所以是 async：登录（A01）、改密（A27）、重置密码都要求 PBKDF2 校验/派生，
 * 而 Web Crypto（`crypto.subtle`）只有异步 API。这里统一用 await 分发，
 * 同步 handler 返回普通信封，await 到的是它本身，行为不变。
 * @param {Object} config axios 请求配置
 * @returns {Promise<Object>} 统一响应信封
 */
export async function handleMockRequest(config) {
  const ctx = normalizeConfig(config)
  try {
    for (const handler of MODULE_HANDLERS) {
      const result = await handler(ctx)
      if (result) {
        return result
      }
    }
    return fail(40401, `接口不存在：${ctx.method} ${ctx.path}`)
  } catch (error) {
    return fail(50001, `mock 服务内部异常：${error.message}`)
  }
}

/**
 * axios adapter 实现：模拟 120–400ms 网络延迟后返回本地数据。
 * @param {Object} config axios 请求配置
 * @returns {Promise<Object>} axios 响应对象
 */
export async function mockAdapter(config) {
  const delay = Math.round(120 + Math.random() * 280)
  await sleep(delay)
  const envelope = await handleMockRequest(config)
  return {
    data: envelope,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json;charset=utf-8' },
    config,
    request: {}
  }
}
