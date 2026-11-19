/**
 * 密码哈希与校验
 *
 * 加密选型：PBKDF2-HMAC-SHA256，600000 次迭代，16 字节随机盐，32 字节输出。
 * 选型理由（留给后人）：
 * 1. 本项目是静态演示站，不能新增依赖；`crypto.subtle` 是 Web 标准，零依赖可用。
 * 2. 600000 次迭代是 OWASP 2023 对 PBKDF2-HMAC-SHA256 的推荐值，本机实测约 87ms，登录可接受。
 * 3. 不选 SHA-256 裸哈希：无盐、可被彩虹表、可被 GPU 暴力；不选 bcrypt/argon2：
 *    需引入依赖且是原生模块，静态站不可行。
 *
 * 存储结构（写入 user.passwordHash）：
 *   { algo: 'PBKDF2-SHA256', iterations: 600000, salt: '<base64 16B>', hash: '<base64 32B>' }
 *
 * 约束：本文件不引用 Vite 专有 API（如 import.meta.env），也不引用浏览器专属对象，
 *       因此可以被 Node 直接 import（scripts/mock-smoke.mjs、scripts/gen-password-seeds.mjs 依赖这一点）。
 */

/** 算法标识，写入 passwordHash.algo，校验时要求一致 */
export const PASSWORD_ALGO = 'PBKDF2-SHA256'
/** 迭代次数（OWASP 2023 推荐值） */
export const PASSWORD_ITERATIONS = 600000
/** 盐长度（字节） */
export const SALT_BYTES = 16
/** 派生密钥长度（bit） */
export const HASH_BITS = 256
/** 密码最小长度 */
export const MIN_PASSWORD_LENGTH = 8
/** 密码最大长度 */
export const MAX_PASSWORD_LENGTH = 32

/**
 * 字节数组转 base64。不用 Buffer：浏览器没有 Buffer，本文件要两端通用。
 * @param {Uint8Array|ArrayBuffer} buffer 字节数据
 * @returns {string} base64 字符串
 */
export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // 分块拼接，避免超长数组一次性展开触发参数上限
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/**
 * base64 转字节数组。不用 Buffer，理由同上。
 * @param {string} base64 base64 字符串
 * @returns {Uint8Array} 字节数组
 */
export function base64ToArrayBuffer(base64) {
  const binary = atob(String(base64))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * 密码策略校验：8–32 位，必须同时包含字母和数字。
 * @param {string} password 明文密码
 * @returns {{ok: boolean, message: string}} 校验结果，未通过时 message 为具体原因
 */
export function validatePasswordStrength(password) {
  const value = String(password ?? '')
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `密码长度需为 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 位`
    }
  }
  if (!/[A-Za-z]/.test(value)) {
    return { ok: false, message: '密码必须包含字母' }
  }
  if (!/[0-9]/.test(value)) {
    return { ok: false, message: '密码必须包含数字' }
  }
  return { ok: true, message: '' }
}

/**
 * 生成随机盐。
 * @returns {Uint8Array} 16 字节随机盐
 */
export function generateSalt() {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  return salt
}

/**
 * 归一化盐入参：既接受 generateSalt() 的字节数组，也接受 storage 里的 base64 文本。
 * @param {Uint8Array|ArrayBuffer|string} salt 盐
 * @returns {Uint8Array} 字节数组
 */
function toSaltBytes(salt) {
  if (salt instanceof Uint8Array) {
    return salt
  }
  if (salt instanceof ArrayBuffer) {
    return new Uint8Array(salt)
  }
  if (typeof salt === 'string' && salt) {
    return base64ToArrayBuffer(salt)
  }
  throw new TypeError('salt 必须为 Uint8Array / ArrayBuffer / base64 字符串')
}

/**
 * 用 PBKDF2-HMAC-SHA256 派生密钥字节。
 * @param {string} password 明文密码
 * @param {Uint8Array} saltBytes 盐字节
 * @param {number} iterations 迭代次数
 * @returns {Promise<Uint8Array>} 派生出的 32 字节密钥
 */
async function deriveHashBytes(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password ?? '')),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    HASH_BITS
  )
  return new Uint8Array(derived)
}

/**
 * 计算密码哈希，返回可直接落库的结构（salt / hash 均为 base64）。
 * @param {string} password 明文密码
 * @param {Uint8Array|string} [salt] 盐；缺省时随机生成
 * @returns {Promise<{algo: string, iterations: number, salt: string, hash: string}>} 哈希结构
 */
export async function hashPassword(password, salt = generateSalt()) {
  const saltBytes = toSaltBytes(salt)
  const hashBytes = await deriveHashBytes(password, saltBytes, PASSWORD_ITERATIONS)
  return {
    algo: PASSWORD_ALGO,
    iterations: PASSWORD_ITERATIONS,
    salt: arrayBufferToBase64(saltBytes),
    hash: arrayBufferToBase64(hashBytes)
  }
}

/**
 * 生成一条全新的哈希记录（新盐 + 新哈希），供改密 / 重置密码使用。
 * @param {string} password 明文密码
 * @returns {Promise<{algo: string, iterations: number, salt: string, hash: string}>} 哈希结构
 */
export async function buildPasswordHash(password) {
  return hashPassword(password, generateSalt())
}

/**
 * 恒定时间比较两个字节数组：逐字节异或后累积，最后判 0，不做提前返回。
 * 提前返回会让「前缀正确长度」等信息通过耗时泄漏，因此这里必须走满整轮。
 * @param {Uint8Array} left 字节数组
 * @param {Uint8Array} right 字节数组
 * @returns {boolean} 是否完全相同
 */
function timingSafeEqual(left, right) {
  // 哈希定长（32 字节），长度本身不是秘密；长度不一致必然不等
  if (left.length !== right.length) {
    return false
  }
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index]
  }
  return diff === 0
}

/**
 * 校验密码是否匹配存储的哈希。存储结构缺失 / 非法时返回 false，不抛异常。
 * @param {string} password 待校验的明文密码
 * @param {{algo: string, iterations: number, salt: string, hash: string}} storedHash 存储的哈希结构
 * @returns {Promise<boolean>} 是否匹配
 */
export async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'object') {
    return false
  }
  const { algo, iterations, salt, hash } = storedHash
  if (algo !== PASSWORD_ALGO) {
    return false
  }
  if (String(salt ?? '') === '' || String(hash ?? '') === '') {
    return false
  }
  const iterationCount = Number(iterations)
  if (!Number.isFinite(iterationCount) || iterationCount <= 0) {
    return false
  }
  try {
    const expected = base64ToArrayBuffer(String(hash))
    const actual = await deriveHashBytes(
      password,
      base64ToArrayBuffer(String(salt)),
      Math.floor(iterationCount)
    )
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
