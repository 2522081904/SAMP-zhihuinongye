/**
 * 写接口幂等号生成器
 * 契约要求所有写接口携带 X-Request-Id，后端据此做重复提交校验（重复返回 40901）。
 * @param {string} prefix 前缀，默认 REQ
 * @returns {string} 请求幂等号
 */
export function createRequestId(prefix = 'REQ') {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

/**
 * 写请求的公共 headers。
 * @param {string} [requestId] 复用已有幂等号（演示 40901 重复提交）
 * @returns {{headers: Object}} axios 请求配置片段
 */
export function writeConfig(requestId) {
  return { headers: { 'X-Request-Id': requestId || createRequestId() } }
}
