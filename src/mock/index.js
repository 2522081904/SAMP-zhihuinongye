/**
 * mock 层入口：按环境开关决定是否接管 axios。
 * 仅在 VITE_USE_MOCK=true 时把 axios 实例的 adapter 替换为本地 mock，
 * 若构建时 VITE_USE_MOCK=false，该模块通过动态 import 不会进入主包。
 */
import { mockAdapter } from './adapter.js'

/**
 * 读取 mock 开关；兼容 Node 环境（无 import.meta.env）。
 * @returns {boolean} 是否启用 mock
 */
function readMockFlag() {
  try {
    return import.meta.env?.VITE_USE_MOCK === 'true'
  } catch {
    return false
  }
}

/**
 * 安装 mock adapter。
 * @param {Object} axiosInstance axios 实例（src/api/request.js 的默认导出）
 * @param {Object} [env] 可注入的环境变量对象，便于单测
 * @returns {boolean} 是否安装成功
 */
export function installMock(axiosInstance, env) {
  const enabled = env ? env.VITE_USE_MOCK === 'true' : readMockFlag()
  if (!enabled || !axiosInstance || !axiosInstance.defaults) {
    return false
  }
  axiosInstance.defaults.adapter = mockAdapter
  // 便于在控制台确认 mock 已生效
  console.info('[mock] 已启用本地假数据，接口请求不会发出网络')
  return true
}

export { mockAdapter }
