/**
 * 物联网设备与环境数据接口（模块：设备与环境监测）
 */
import request from '@/api/request'

/** 设备分页列表 */
export function getDevicePage(params) {
  return request.get('/iot/devices', { params })
}

/** 设备详情 */
export function getDeviceDetail(deviceId) {
  return request.get(`/iot/devices/${deviceId}`)
}

/** 实时环境数据（温湿度、光照、CO2、土壤墒情） */
export function getEnvRealtime(params) {
  return request.get('/iot/env/realtime', { params })
}

/** 历史环境数据，用于趋势分析 */
export function getEnvHistory(params) {
  return request.get('/iot/env/history', { params })
}

/** 下发设备控制指令 */
export function sendControlCommand(data) {
  return request.post('/iot/control/command', data)
}

/** 控制日志分页列表 */
export function getControlLogPage(params) {
  return request.get('/iot/control/logs', { params })
}

/** 告警分页列表 */
export function getAlertPage(params) {
  return request.get('/iot/alerts', { params })
}

/** 告警处置 */
export function handleAlert(alertId, data) {
  return request.post(`/iot/alerts/${alertId}/handle`, data)
}
