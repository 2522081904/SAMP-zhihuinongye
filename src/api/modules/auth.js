/**
 * 认证与账号接口（模块：认证中心）
 * 骨架阶段仅保留最小可用示例，后续按接口文档补充。
 */
import request from '@/api/request'

/** 账号密码登录，返回 { token, user } */
export function login(data) {
  return request.post('/auth/login', data)
}

/** 退出登录 */
export function logout() {
  return request.post('/auth/logout')
}

/** 获取当前登录用户信息与权限码 */
export function getProfile() {
  return request.get('/auth/profile')
}
