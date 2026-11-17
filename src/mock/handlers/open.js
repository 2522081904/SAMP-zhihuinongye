/**
 * 开放平台模块 mock handler（A26）
 * 负责第三方应用列表、应用创建与访问令牌换取。
 */
import { findApp, NOW_MS, openApps } from '../db.js'
import {
  fail,
  formatDateTime,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue
} from '../utils.js'
import { currentUser, requireAdmin, unauthorized } from './auth.js'

// 令牌有效期（秒）
const TOKEN_EXPIRES_IN = 7200

/**
 * 列表场景下对 appSecret 做掩码，避免密钥明文回显。
 * @param {Object} app 应用
 * @returns {Object} 掩码后的应用
 */
function maskApp(app) {
  return {
    ...app,
    appSecret: `${String(app.appSecret).slice(0, 8)}****`
  }
}

/**
 * 开放平台模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleOpen(ctx) {
  const { method, path, query } = ctx

  // A26 第三方应用列表：GET /open/apps
  if (method === 'GET' && matchPath(path, '/open/apps')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const list = openApps
      .filter(
        (app) =>
          (!status || app.status === status) &&
          matchKeyword([app.appId, app.appName, app.scopes.join(',')], keyword)
      )
      .map((app) => maskApp(app))
    return ok(paginate(list, query))
  }

  // A26 创建第三方应用：POST /open/apps
  if (method === 'POST' && matchPath(path, '/open/apps')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const body = ctx.body || {}
    const appName = String(body.appName || '').trim()
    if (isBlank(appName)) {
      return fail(40001, '应用名称不能为空')
    }
    const id = openApps.reduce((max, app) => Math.max(max, app.id), 0) + 1
    const app = {
      id,
      appId: `APP-2026-${String(id).padStart(4, '0')}`,
      appName,
      appSecret: `sec_agri_${String(id).toString(16).padStart(2, '0')}c${String(id * 7).padStart(4, '0')}`,
      status: 'ENABLED',
      statusName: '已启用',
      scopes: Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ['trace:read'],
      createdAt: formatDateTime(NOW_MS),
      lastAccessAt: ''
    }
    openApps.unshift(app)
    // 创建时返回完整密钥，仅此一次
    return ok(app, '应用已创建，请妥善保存 appSecret')
  }

  // A26 换取访问令牌：POST /open/token（第三方系统直连，不依赖登录态）
  if (method === 'POST' && matchPath(path, '/open/token')) {
    const body = ctx.body || {}
    const appId = String(body.appId || '').trim()
    const appSecret = String(body.appSecret || '').trim()
    if (isBlank(appId) || isBlank(appSecret)) {
      return fail(40001, 'appId 与 appSecret 不能为空')
    }
    const app = findApp(appId)
    if (!app || app.appSecret !== appSecret) {
      return fail(40102, '应用凭证不正确')
    }
    if (app.status === 'DISABLED') {
      return fail(42301, '该应用已被停用，请联系平台管理员')
    }
    const issuedAt = formatDateTime(NOW_MS)
    app.lastAccessAt = issuedAt
    return ok(
      {
        accessToken: `oat_${app.appId.slice(-4)}_${Date.now().toString(36)}`,
        tokenType: 'Bearer',
        expiresIn: TOKEN_EXPIRES_IN,
        appId: app.appId,
        appName: app.appName,
        scopes: app.scopes,
        issuedAt
      },
      '令牌换取成功'
    )
  }

  return null
}
