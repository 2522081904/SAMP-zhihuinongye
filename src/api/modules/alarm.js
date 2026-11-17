/**
 * 告警接口封装（A19 / A20）
 * 已处置/已忽略的告警再次处置返回 40901。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A19 告警列表（分页 + 级别/状态/设备/地块/时间过滤） · P025/P026 */
export const fetchAlarms = (params) => request.get('/alarms', { params })

/** A19 告警详情 · P025 */
export const fetchAlarmDetail = (id) => request.get(`/alarms/${id}`)

/** A20 告警处置（body: { status: 'CONFIRMED'|'RESOLVED'|'IGNORED', remark }） · P025/P026 */
export const handleAlarm = (id, payload) =>
  request.post(`/alarms/${id}/handle`, payload, writeConfig())

/** 扩展 告警统计（按级别/状态/地块聚合，供图表） · P025/P026 */
export const fetchAlarmStatistics = () => request.get('/alarms/statistics')

/** 扩展 新增告警（规则调试与页面联调用） · P026 */
export const createAlarm = (payload) => request.post('/alarms', payload, writeConfig())
