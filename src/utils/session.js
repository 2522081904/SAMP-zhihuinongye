/**
 * 登录会话有效期（唯一数据源）
 *
 * 为什么需要它：
 * 登录接口 A01 返回 expiresIn（秒），但前端此前只存 token、从不看有效期，
 * 于是一个 token 一旦写进 localStorage 就永久有效——演示环境里表现为
 * 「前两天用农户账号登过一次，今天再打开网址直接进农户首页」。
 *
 * 设计取舍：
 *   - 过期时间与 token 同存 localStorage，刷新与多标签共享，不额外引入依赖；
 *   - 读取时做「过期即删除」，让后续逻辑只面对「有 token」与「无 token」两态；
 *   - 时钟回拨（本机时间被调早）不视为失效，避免误踢；只有 now >= expiresAt 才算过期；
 *   - 本模块同时被浏览器与可能的 Node 侧引用，因此对 localStorage 做存在性守卫。
 */

/** token 存储键（与 api/request.js、store/modules/user.js 保持一致） */
export const TOKEN_KEY = 'agri_token'

/** 过期时间戳存储键：值为毫秒时间戳字符串 */
export const TOKEN_EXPIRES_KEY = 'agri_token_expires_at'

/** 默认有效期（秒）：与 mock 层 A01 返回的 expiresIn 对齐，2 小时 */
export const DEFAULT_EXPIRES_IN = 7200

/**
 * localStorage 是否可用（Node 侧 import 时安全降级）。
 * @returns {boolean}
 */
function hasStorage() {
  return typeof localStorage !== 'undefined' && Boolean(localStorage)
}

/**
 * 写入令牌与过期时间。
 * @param {string} token 登录令牌
 * @param {number} [expiresIn] 有效期（秒），缺省用 DEFAULT_EXPIRES_IN
 */
export function saveSession(token, expiresIn) {
  if (!hasStorage()) {
    return
  }
  if (!token) {
    clearSession()
    return
  }
  const seconds = Number(expiresIn) > 0 ? Number(expiresIn) : DEFAULT_EXPIRES_IN
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(TOKEN_EXPIRES_KEY, String(Date.now() + seconds * 1000))
}

/**
 * 读取有效令牌。已过期则顺手清掉并返回空串。
 * @returns {string} 有效令牌；无令牌或已过期返回 ''
 */
export function readSession() {
  return readSessionState().token
}

/**
 * 一次性读取登录态并告知「是否因过期被清掉」。
 * 必须在清理之前判定，否则调用方拿不到过期这个事实——所以单独提供本函数，
 * 供 store 初始化时区分「从没登录过」与「登录过期了」两种空令牌。
 * @returns {{token: string, expired: boolean}} token 为有效令牌；expired 表示本次因过期被清
 */
export function readSessionState() {
  if (!hasStorage()) {
    return { token: '', expired: false }
  }
  const token = localStorage.getItem(TOKEN_KEY) || ''
  if (!token) {
    return { token: '', expired: false }
  }
  const rawExpires = localStorage.getItem(TOKEN_EXPIRES_KEY)
  // 没有过期时间的旧令牌：属于本次改造前写入的历史数据，一律按失效处理，
  // 否则「旧 token 永久有效」的问题会继续存在。
  if (!rawExpires) {
    clearSession()
    return { token: '', expired: true }
  }
  const expiresAt = Number(rawExpires)
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    clearSession()
    return { token: '', expired: true }
  }
  return { token, expired: false }
}

/**
 * 判断本地是否存在「已过期或缺少有效期」的历史登录态。
 * 只读不清理：调用方通常在 readSessionState() 之后使用，两者都不该互相干扰。
 * @returns {boolean} 是否有失效的登录态残留
 */
export function hasStaleSession() {
  if (!hasStorage()) {
    return false
  }
  if (!localStorage.getItem(TOKEN_KEY)) {
    return false
  }
  const rawExpires = localStorage.getItem(TOKEN_EXPIRES_KEY)
  if (!rawExpires) {
    return true
  }
  const expiresAt = Number(rawExpires)
  return !Number.isFinite(expiresAt) || Date.now() >= expiresAt
}

/**
 * 清除令牌与过期时间。
 */
export function clearSession() {
  if (!hasStorage()) {
    return
  }
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_EXPIRES_KEY)
}

/**
 * 剩余有效期（毫秒）。未登录或已过期返回 0。
 * @returns {number}
 */
export function remainingMs() {
  if (!hasStorage()) {
    return 0
  }
  const rawExpires = localStorage.getItem(TOKEN_EXPIRES_KEY)
  if (!localStorage.getItem(TOKEN_KEY) || !rawExpires) {
    return 0
  }
  const expiresAt = Number(rawExpires)
  if (!Number.isFinite(expiresAt)) {
    return 0
  }
  return Math.max(0, expiresAt - Date.now())
}
