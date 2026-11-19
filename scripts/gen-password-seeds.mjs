#!/usr/bin/env node
/**
 * 密码种子常量生成器
 *
 * 背景：`src/mock/db.js` 顶层是同步模块，而 Web Crypto 的 PBKDF2 只有异步 API（`crypto.subtle`）。
 * 为了不把 db.js 改成异步模块（会引发大面积连锁改动），种子账号的 `passwordHash`
 * 改为在本脚本里预生成、以常量形式写死进 db.js。
 *
 * 用法：
 *   node scripts/gen-password-seeds.mjs                 # 生成默认初始密码 Agri@2026 的常量
 *   node scripts/gen-password-seeds.mjs 'Other@2027'    # 换初始密码后重新生成
 *
 * 生成结果直接粘贴覆盖 `src/mock/db.js` 里的 `PASSWORD_HASHES` 常量即可。
 * 注意：每次运行盐都是随机的新值，输出因此每次不同，这是预期的（同密码不同盐）。
 */
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  buildPasswordHash,
  validatePasswordStrength,
  verifyPassword
} from '../src/mock/password.js'
import { users } from '../src/mock/db.js'

// 与 src/views/system/UserList.vue 的 DEFAULT_PASSWORD 保持一致，保证「重置后真能用新密码登录」
const DEFAULT_PASSWORD = process.argv[2] || 'Agri@2026'

const strength = validatePasswordStrength(DEFAULT_PASSWORD)
if (!strength.ok) {
  console.error(`初始密码不满足策略（${strength.message}）：${DEFAULT_PASSWORD}`)
  process.exit(1)
}

console.log(`// 初始密码：${DEFAULT_PASSWORD}`)
console.log('// 由 node scripts/gen-password-seeds.mjs 生成，每条盐值不同，请勿手工编辑')
console.log('const PASSWORD_HASHES = {')

for (const user of users) {
  const hash = await buildPasswordHash(DEFAULT_PASSWORD)
  console.log(`  ${user.username}: {`)
  console.log(`    algo: '${hash.algo}',`)
  console.log(`    iterations: ${hash.iterations},`)
  console.log(`    salt: '${hash.salt}',`)
  console.log(`    hash: '${hash.hash}'`)
  console.log('  },')
  // 自检：生成的常量必须能被 verifyPassword 验证通过，否则立刻报错而不是产出坏常量
  const roundTrip = await verifySeed(DEFAULT_PASSWORD, hash)
  if (!roundTrip) {
    console.error(`生成校验失败：${user.username}`)
    process.exit(1)
  }
}

console.log('}')

/**
 * 生成后立刻回验，避免写出坏常量。
 * @param {string} password 明文密码
 * @param {Object} hash 哈希结构
 * @returns {Promise<boolean>} 是否验证通过
 */
async function verifySeed(password, hash) {
  const good = await verifyPassword(password, hash)
  const bad = await verifyPassword(`${password}x`, hash)
  // 顺带确认 base64 编解码往返一致
  const saltRoundTrip = arrayBufferToBase64(base64ToArrayBuffer(hash.salt)) === hash.salt
  const hashRoundTrip = arrayBufferToBase64(base64ToArrayBuffer(hash.hash)) === hash.hash
  return good && !bad && saltRoundTrip && hashRoundTrip
}
