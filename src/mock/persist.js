/**
 * mock 层持久化：把角色权限变更落到 localStorage，刷新后 hydrate 回内存。
 *
 * 为什么单独一个模块，而不是直接改 db.js：
 * `scripts/mock-smoke.mjs` 在 Node 里直接 import `src/mock/db.js`，Node 没有 localStorage；
 * 若把落盘逻辑写进 db.js 的模块顶层，Node 下整个自检脚本会直接崩。
 * `src/mock/index.js` 的 installMock() 只在浏览器里被调用，是天然的浏览器/Node 分界线，
 * 因此 hydrate 挂在 installMock() 里，Node 路径天然绕过。
 *
 * 注意：本模块允许引用浏览器对象，但必须自带 localStorage 存在性守卫，
 * 以确保被 Node 侧（scripts/mock-smoke.mjs）误 import 时安全降级为空操作。
 */
import { formatDateTime } from './utils.js'
import { roles, users } from './db.js'

/** 权限快照的存储键（带版本号，结构变更时换 key 即可自然丢弃旧数据） */
const PERSIST_KEY = 'agri-mock-roles-v1'

/** 已被本方案取代的旧键：只在本地覆盖勾选状态，不参与鉴权，启动时顺手清掉 */
const LEGACY_KEY = 'agri-role-perms-v1'

/** 快照结构版本，读到不认识的版本一律当作无快照 */
const PERSIST_VERSION = 1

/**
 * 判断当前环境是否具备持久化能力。
 * Node（scripts/mock-smoke.mjs）下 localStorage 不存在，返回 false，调用方据此空操作。
 * @returns {boolean} localStorage 是否可用
 */
export function isPersistAvailable() {
  return typeof localStorage !== 'undefined' && Boolean(localStorage)
}

/**
 * 读取并解析快照；无快照 / JSON 损坏 / 版本不认识时返回 null。
 * @returns {{version:number, roles:Object, savedAt?:string}|null} 快照对象
 */
function readSnapshot() {
  if (!isPersistAvailable()) {
    return null
  }
  let raw = null
  try {
    raw = localStorage.getItem(PERSIST_KEY)
  } catch {
    return null
  }
  if (!raw) {
    return null
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== PERSIST_VERSION) {
    return null
  }
  if (!parsed.roles || typeof parsed.roles !== 'object') {
    return null
  }
  return parsed
}

/**
 * 清掉上一版方案遗留的脏键（agri-role-perms-v1）。
 * 旧键只用于回填勾选框，不参与鉴权，留着会让人误以为它还有用。
 * @returns {void}
 */
function dropLegacyKey() {
  if (!isPersistAvailable()) {
    return
  }
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // 存储不可写时忽略：清理是尽力而为，不该影响页面启动
  }
}

/**
 * 把快照里的角色权限 hydrate 回内存，并重新同步用户权限快照。
 *
 * 为什么必须同步 users：db.js 构造 users 时 `perms: [...(role?.perms || [])]` 是拷贝，
 * 只改 roles 不会传导到 users；而登录鉴权读的是 `user.perms`（handlers/auth.js 的 userHasPerm）。
 * 漏了这步就会出现「角色改了但登录进去还是老权限」，正是本次要修的 bug 换个地方复现。
 * @returns {void}
 */
export function hydrateRuntime() {
  dropLegacyKey()
  const snapshot = readSnapshot()
  if (!snapshot) {
    return
  }
  const saved = snapshot.roles
  Object.keys(saved).forEach((code) => {
    // 只应用当前种子里仍然存在的角色，旧快照里残留的已删角色直接跳过
    const role = roles.find((item) => item.code === code)
    const codes = saved[code]
    if (!role || !Array.isArray(codes)) {
      return
    }
    // 只覆盖权限：name / description / dataScope / userCount / createdAt 一律以种子为准
    role.perms = [...codes]
  })
  users.forEach((user) => {
    const role = roles.find((item) => item.code === user.roleCode)
    if (role) {
      user.perms = [...role.perms]
      user.roleName = role.name
    }
  })
}

/**
 * 把单个角色的权限写入快照。
 * 落盘是尽力而为：失败只意味着下次刷新不保留，不该让用户看到「保存失败」。
 * @param {Object} role 角色对象（至少包含 code 与 perms）
 * @returns {boolean} 是否写入成功
 */
export function persistRolePerms(role) {
  if (!isPersistAvailable() || !role || !role.code) {
    return false
  }
  const snapshot = readSnapshot() || { version: PERSIST_VERSION, roles: {} }
  const next = {
    version: PERSIST_VERSION,
    roles: { ...snapshot.roles, [role.code]: [...(role.perms || [])] },
    // savedAt 是真实世界的时间戳，只用于排查，不参与任何业务判断
    savedAt: formatDateTime(Date.now())
  }
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(next))
    return true
  } catch {
    // 隐私模式 / 配额用尽时 setItem 会抛，静默降级为空操作
    return false
  }
}

/**
 * 删除快照，回到种子默认权限（需要刷新页面才生效）。
 * @returns {boolean} 是否删除成功
 */
export function clearPersist() {
  if (!isPersistAvailable()) {
    return false
  }
  try {
    localStorage.removeItem(PERSIST_KEY)
    return true
  } catch {
    return false
  }
}

export { PERSIST_KEY, LEGACY_KEY, PERSIST_VERSION }
