/**
 * 认证接口封装（A01 / A02）
 * 页面只认这里的函数，不要直接拼 URL。
 */
import request from '../request.js'

/** A01 账号登录 · P001 */
export const login = (payload) => request.post('/auth/login', payload)

/** A02 当前用户信息与菜单权限 · P002 */
export const fetchCurrentUser = () => request.get('/auth/me')
