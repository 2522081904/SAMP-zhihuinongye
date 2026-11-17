/**
 * 物联网感知接口封装（A03 / A06 / A07）
 * 页面只认这里的函数，不要直接拼 URL。
 */
import request from '../request.js'

/** A03 设备台账查询（分页 + 多条件过滤） · P003/P006 */
export const fetchDevices = (params) => request.get('/iot/devices', { params })

/** A03 设备详情（含最近遥测、告警与指令） · P003/P006 */
export const fetchDeviceDetail = (code) => request.get(`/iot/devices/${code}`)

/** A06 实时环境数据（按地块返回设备当前指标） · P002/P003 */
export const fetchRealtime = (params) => request.get('/iot/realtime', { params })

/** A07 历史时序数据（deviceCode/from/to/interval） · P003/P004 */
export const fetchHistory = (params) => request.get('/iot/history', { params })
