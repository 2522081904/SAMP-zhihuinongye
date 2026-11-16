/**
 * 告警处置接口（模块：告警中心）
 */
import request from '@/api/request'

/** 告警列表（支持按等级、状态、时间范围筛选） */
export function getAlertList(params) {
  return request.get('/alerts', { params })
}

/** 告警处置提交 */
export function submitAlertHandle(alertId, data) {
  return request.post(`/alerts/${alertId}/handle`, data)
}

/** 告警统计（按等级与模块聚合） */
export function getAlertStatistics(params) {
  return request.get('/alerts/statistics', { params })
}
