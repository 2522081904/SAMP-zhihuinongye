/**
 * 认证模块 mock handler（A01 / A02）
 * 入参 ctx 为归一化后的请求上下文：{ method, path, query, body, headers }，
 * 由 src/mock/index.js 从 axios config 转换而来；返回统一响应信封或 null（未匹配）。
 */
import { fail, isBlank, matchPath, ok } from '../utils.js'
import { findRole, findUser, menuGroups, users } from '../db.js'
import { MENU_PERMISSION_CODES } from '@/constants/permissions.js'

// 登录令牌前缀：形如 mock-token-admin-1731xxxx，A02 及其他接口据此还原当前用户
const TOKEN_PATTERN = /^mock-token-([A-Za-z0-9_]+)-\d+$/

/**
 * 判断用户是否拥有某个权限码（管理员 '*' 通配）。
 * @param {Object} user 用户对象
 * @param {string} code 权限码
 * @returns {boolean} 是否放行
 */
function userHasPerm(user, code) {
  const owned = user?.perms || []
  return owned.includes('*') || owned.includes(code)
}

/**
 * 按当前用户权限过滤菜单树，并丢弃过滤后没有条目的分组。
 * 真实后端不会把越权菜单下发到前端，mock 在这里对齐该行为（前端过滤是双保险的第二道）。
 * db.js 的 MENU_GROUPS 条目只有 { path, title, pageId }，没有 perm 字段，
 * 所以用共享常量 MENU_PERMISSION_CODES 按 path 反查；查不到的条目按「无权限码」放行。
 * @param {Object} user 当前用户
 * @returns {Array<{title: string, items: Array}>} 过滤后的菜单分组
 */
function filterMenuGroups(user) {
  return menuGroups
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => {
        const code = MENU_PERMISSION_CODES[item.path]
        return !code || userHasPerm(user, code)
      })
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * 把内部用户对象转为对外返回的用户信息。
 * `perms` 是权限码数组（管理员为 ['*']），`permissions` 为兼容字段，值与之相同。
 * @param {Object} user 用户对象
 * @returns {Object} 对外用户信息
 */
export function userPublic(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone || '',
    email: user.email || '',
    avatar: '',
    role: user.roleCode,
    roleCode: user.roleCode,
    roleName: user.roleName,
    perms: [...(user.perms || [])],
    permissions: [...(user.perms || [])],
    plotIds: [...(user.plotIds || [])],
    status: user.status,
    lastLoginAt: user.lastLoginAt || ''
  }
}

/**
 * 从请求头解析当前登录用户。
 * 支持 axios 的 AxiosHeaders 与普通对象（headers 已由 index.js 统一转为小写键）。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 用户对象；未登录或令牌非法时返回 null
 */
export function currentUser(ctx) {
  const authorization = String(ctx?.headers?.authorization || '')
  const matched = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  if (!matched) {
    return null
  }
  const tokenMatched = TOKEN_PATTERN.exec(matched[1].trim())
  if (!tokenMatched) {
    return null
  }
  return findUser(tokenMatched[1])
}

/**
 * 未登录统一返回 40101。
 * @returns {Object} 响应信封
 */
export function unauthorized() {
  return fail(40101, '未登录或登录凭证已失效，请重新登录')
}

/**
 * 越权统一返回 40301。
 * @param {string} message 提示文案
 * @returns {Object} 响应信封
 */
export function forbidden(message = '没有访问该资源的权限') {
  return fail(40301, message)
}

/**
 * 仅管理员可执行的操作校验。
 * @param {Object} user 当前用户
 * @returns {Object|null} 无权限时返回 40301 信封，否则返回 null
 */
export function requireAdmin(user) {
  if (user?.roleCode === 'ADMIN' || (user?.perms || []).includes('*')) {
    return null
  }
  return forbidden('该操作仅限管理员')
}

/**
 * 判断账号是否被停用。
 * @param {Object} user 用户对象
 * @returns {boolean} 是否停用
 */
function isDisabled(user) {
  return user?.status === 'DISABLED'
}

/**
 * 认证模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleAuth(ctx) {
  const { method, path } = ctx

  // A01 账号登录：POST /auth/login
  if (method === 'POST' && matchPath(path, '/auth/login')) {
    const body = ctx.body || {}
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')
    if (isBlank(username) || isBlank(password)) {
      return fail(40001, '账号和密码不能为空')
    }
    // 固定组合用于演示「账号或密码错误」，便于联调时复现 40102
    if (password === 'wrong') {
      return fail(40102, '账号或密码错误')
    }
    const matchedUser = findUser(username)
    // 任意非空账号都可以登录：未知账号按「基地农户」角色临时签发，仅用于演示
    const fallbackRole = findRole('FARMER')
    const loginUser = matchedUser ||
      users.find(() => false) || {
        id: users.length + 1,
        username,
        name: username,
        phone: '',
        roleCode: fallbackRole?.code || 'FARMER',
        roleName: fallbackRole?.name || '基地农户',
        perms: [...(fallbackRole?.perms || [])],
        plotIds: [],
        status: 'ENABLED',
        lastLoginAt: ''
      }
    if (isDisabled(loginUser)) {
      return fail(42301, '账号已被锁定，请联系管理员')
    }
    const token = `mock-token-${loginUser.username}-${Date.now()}`
    return ok(
      {
        token,
        tokenType: 'Bearer',
        expiresIn: 7200,
        userInfo: userPublic(loginUser)
      },
      '登录成功'
    )
  }

  // A02 当前用户信息与菜单权限：GET /auth/me
  if (method === 'GET' && matchPath(path, '/auth/me')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    return ok({
      user: userPublic(user),
      // 菜单树按当前角色权限过滤后下发：即使前端过滤失效，也不该把越权菜单送到浏览器
      menus: filterMenuGroups(user),
      roles: [user.roleCode],
      permissions: [...(user.perms || [])]
    })
  }

  return null
}
