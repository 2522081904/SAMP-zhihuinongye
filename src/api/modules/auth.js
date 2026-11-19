/**
 * 认证接口封装（A01 / A02 / A27）
 * 页面只认这里的函数，不要直接拼 URL。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A01 账号登录 · P001 */
export const login = (payload) => request.post('/auth/login', payload)

/** A02 当前用户信息与菜单权限 · P002 */
export const fetchCurrentUser = () => request.get('/auth/me')

/** A27 自助修改密码（body: { oldPassword, newPassword }） · 个人信息页 */
export const changePassword = (payload) => request.put('/auth/password', payload, writeConfig())
