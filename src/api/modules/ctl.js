/**
 * 远程控制接口封装（A04 / A05 / A08 / A09）
 * 下发指令属于写接口，自动带 X-Request-Id，重复提交由后端返回 40901。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A04 下发控制指令（X-Request-Id 幂等，安全锁开启返回 42301） · P007/P009 */
export const sendCommand = (payload) => request.post('/ctl/commands', payload, writeConfig())

/** A05 指令执行回执（首次 PENDING，再次查询为 SUCCESS） · P007/P003 */
export const fetchCommand = (requestId) => request.get(`/ctl/commands/${requestId}`)

/** A08 控制策略列表 · P008/P026 */
export const fetchStrategies = (params) => request.get('/ctl/strategies', { params })

/** A08 新增控制策略 · P008 */
export const createStrategy = (payload) => request.post('/ctl/strategies', payload, writeConfig())

/** A08 修改控制策略 · P008 */
export const updateStrategy = (id, payload) =>
  request.put(`/ctl/strategies/${id}`, payload, writeConfig())

/** A09 控制日志（分页，按设备/状态/操作人/时间过滤） · P009 */
export const fetchControlLogs = (params) => request.get('/ctl/logs', { params })

/** A04 安全锁状态查询（P007 远程控制页展示锁定态） · P007 */
export const fetchSafetyLock = () => request.get('/ctl/safety-lock')

/** A04 切换安全锁（演示 42301 场景） · P007 */
export const updateSafetyLock = (payload) =>
  request.post('/ctl/safety-lock', payload, writeConfig())
