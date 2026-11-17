/**
 * 开放平台接口封装（A26）
 * 应用列表与创建仅限管理员；换取令牌为第三方系统直连，不依赖登录态。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A26 第三方应用列表（appSecret 掩码） · P030 */
export const fetchOpenApps = (params) => request.get('/open/apps', { params })

/** A26 创建第三方应用（返回一次性明文 appSecret） · P030 */
export const createOpenApp = (payload) => request.post('/open/apps', payload, writeConfig())

/** A26 换取访问令牌（body: { appId, appSecret }） · P030 */
export const exchangeOpenToken = (payload) => request.post('/open/token', payload, writeConfig())
