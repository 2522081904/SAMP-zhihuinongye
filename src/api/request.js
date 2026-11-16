/**
 * axios 统一请求封装
 * - baseURL 取环境变量 VITE_API_BASE_URL
 * - 请求头自动携带 Authorization: Bearer <token>
 * - 响应按 { code, message, data, requestId, timestamp } 解包
 * - code !== 0 视为业务失败：ElMessage 提示并 reject
 * - code === 40101（登录态失效）：清 token 并跳转 /login
 */
import axios from 'axios'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'

const TOKEN_KEY = 'agri_token'

const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json;charset=utf-8' }
})

// 请求拦截：注入 token 与请求标识
service.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截：解包业务数据，统一错误提示
service.interceptors.response.use(
  (response) => {
    const body = response.data
    // 兼容非标准响应（例如直接返回文件流）
    if (!body || typeof body !== 'object' || !('code' in body)) {
      return body
    }
    if (body.code === 0) {
      return body.data
    }
    if (body.code === 40101) {
      localStorage.removeItem(TOKEN_KEY)
      ElMessage.error('登录已失效，请重新登录')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      return Promise.reject(new Error(body.message || '登录已失效'))
    }
    ElMessage.error(body.message || '请求处理失败')
    return Promise.reject(new Error(body.message || '请求处理失败'))
  },
  (error) => {
    const status = error.response?.status
    let message = error.message || '网络异常'
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      message = '未登录或登录已过期'
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    } else if (status === 403) {
      message = '没有访问该资源的权限'
    } else if (status === 404) {
      message = '请求的接口不存在'
    } else if (status >= 500) {
      message = '服务器异常，请稍后重试'
    } else if (error.code === 'ECONNABORTED') {
      message = '请求超时，请检查网络'
    }
    ElMessage.error(message)
    return Promise.reject(error)
  }
)

export default service
export { TOKEN_KEY }
