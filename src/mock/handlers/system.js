/**
 * 系统管理模块 mock handler（A25）
 * 负责用户与角色查询、新增用户、角色新增与修改、管理员重置用户密码。
 *
 * 注意：本模块会被 Node 直接 import（scripts/mock-smoke.mjs 依赖这一点），
 * 因此导入路径必须是相对路径，不能用 Vite 别名 `@`。
 */
import {
  findRole,
  findUser,
  NOW_MS,
  roles,
  seedPassword,
  updatePasswordHash,
  users
} from '../db.js'
import { buildPasswordHash } from '../password.js'
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
import { currentUser, requireAdmin, unauthorized, userPublic } from './auth.js'

/**
 * 系统管理模块路由入口。
 * 本函数是 async：管理员重置密码要 await PBKDF2 派生（Web Crypto 只有异步 API）。
 * @param {Object} ctx 请求上下文
 * @returns {Promise<Object|null>} 响应信封；未匹配返回 null
 */
export async function handleSystem(ctx) {
  const { method, path, query } = ctx

  // A25 用户列表：GET /system/users
  if (method === 'GET' && matchPath(path, '/system/users')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const keyword = queryValue(query, 'keyword')
    const roleCode = queryValue(query, 'roleCode')
    const status = queryValue(query, 'status')
    const list = users
      .filter(
        (item) =>
          (!roleCode || item.roleCode === roleCode) &&
          (!status || item.status === status) &&
          matchKeyword([item.username, item.name, item.phone, item.roleName], keyword)
      )
      .map((item) => userPublic(item))
    return ok(paginate(list, query))
  }

  // A25 新增用户：POST /system/users
  if (method === 'POST' && matchPath(path, '/system/users')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const body = ctx.body || {}
    const username = String(body.username || '').trim()
    const name = String(body.name || '').trim()
    const roleCode = String(body.roleCode || '').trim()
    if (isBlank(username) || isBlank(name) || isBlank(roleCode)) {
      return fail(40001, '账号、姓名与角色不能为空')
    }
    if (findUser(username)) {
      return fail(40901, `账号 ${username} 已存在`)
    }
    const role = findRole(roleCode)
    if (!role) {
      return fail(40401, `角色 ${roleCode} 不存在`)
    }
    const id = users.reduce((max, item) => Math.max(max, item.id), 0) + 1
    const created = {
      id,
      username,
      name,
      phone: String(body.phone || ''),
      email: String(body.email || ''),
      roleCode: role.code,
      roleName: role.name,
      perms: [...role.perms],
      plotIds: Array.isArray(body.plotIds) ? body.plotIds : [],
      // 新建用户同样带初始密码哈希，否则该账号永远无法登录（登录已改为真实校验）
      passwordHash: await buildPasswordHash(seedPassword()),
      status: String(body.status || 'ENABLED'),
      statusName: String(body.status || 'ENABLED') === 'ENABLED' ? '正常' : '停用',
      lastLoginAt: '',
      createdAt: formatDateTime(NOW_MS)
    }
    users.push(created)
    role.userCount += 1
    return ok(userPublic(created), '用户已创建')
  }

  // 扩展：管理员重置用户密码（重置为初始密码）
  // 注意：/system/users/:id/reset-password 是 4 段路径，下面的 matchPath('/system/users/:id')
  // 因段数严格相等（3 段 ≠ 4 段）不会误吞，两个分支互不影响。
  const resetPath = matchPath(path, '/system/users/:id/reset-password')
  if (method === 'POST' && resetPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const target = users.find((item) => String(item.id) === String(resetPath.id))
    if (!target) {
      return fail(40401, `用户 ${resetPath.id} 不存在`)
    }
    const initialPassword = seedPassword()
    updatePasswordHash(target.username, await buildPasswordHash(initialPassword))
    return ok(null, `密码已重置为 ${initialPassword}`)
  }

  // 扩展：修改用户（P029 编辑角色/停用账号）
  const userPath = matchPath(path, '/system/users/:id')
  if (method === 'PUT' && userPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const target = users.find((item) => String(item.id) === String(userPath.id))
    if (!target) {
      return fail(40401, `用户 ${userPath.id} 不存在`)
    }
    const body = ctx.body || {}
    if (body.roleCode !== undefined) {
      const role = findRole(body.roleCode)
      if (!role) {
        return fail(40401, `角色 ${body.roleCode} 不存在`)
      }
      target.roleCode = role.code
      target.roleName = role.name
      target.perms = [...role.perms]
    }
    ;['name', 'phone', 'email', 'status'].forEach((key) => {
      if (body[key] !== undefined) {
        target[key] = body[key]
      }
    })
    if (body.plotIds !== undefined) {
      target.plotIds = Array.isArray(body.plotIds) ? body.plotIds : []
    }
    target.statusName = target.status === 'ENABLED' ? '正常' : '停用'
    return ok(userPublic(target), '用户已更新')
  }

  // A25 角色列表：GET /system/roles
  if (method === 'GET' && matchPath(path, '/system/roles')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const keyword = queryValue(query, 'keyword')
    const list = roles.filter((role) =>
      matchKeyword([role.code, role.name, role.description], keyword)
    )
    return ok(paginate(list, query))
  }

  // A25 新增或修改角色：POST /system/roles（带 id 视为修改，返回更新后的角色对象）
  if (method === 'POST' && matchPath(path, '/system/roles')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const body = ctx.body || {}
    const hasId = body.id !== undefined && body.id !== null && String(body.id) !== ''
    if (hasId) {
      const role = findRole(body.id)
      if (!role) {
        return fail(40401, `角色 ${body.id} 不存在`)
      }
      ;['name', 'description', 'dataScope'].forEach((key) => {
        if (body[key] !== undefined) {
          role[key] = body[key]
        }
      })
      if (Array.isArray(body.perms)) {
        role.perms = [...body.perms]
        // 同步角色下用户的权限快照
        users
          .filter((item) => item.roleCode === role.code)
          .forEach((item) => {
            item.perms = [...role.perms]
            item.roleName = role.name
          })
      }
      return ok(role, '角色已更新')
    }
    const code = String(body.code || '')
      .trim()
      .toUpperCase()
    const name = String(body.name || '').trim()
    if (isBlank(code) || isBlank(name)) {
      return fail(40001, '角色编码与角色名称不能为空')
    }
    if (roles.some((role) => role.code === code)) {
      return fail(40901, `角色编码 ${code} 已存在`)
    }
    const role = {
      id: roles.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      code,
      name,
      description: String(body.description || ''),
      perms: Array.isArray(body.perms) ? body.perms : [],
      dataScope: String(body.dataScope || 'SELF'),
      userCount: 0,
      createdAt: formatDateTime(NOW_MS)
    }
    roles.push(role)
    return ok(role, '角色已创建')
  }

  return null
}
