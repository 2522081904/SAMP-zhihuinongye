/**
 * 数据分析与报表接口（模块：数据分析）
 */
import request from '@/api/request'

/** 总览指标（产量、投入、告警、在田面积） */
export function getOverviewMetrics(params) {
  return request.get('/analysis/overview', { params })
}

/** 报表列表 */
export function getReportList(params) {
  return request.get('/analysis/reports', { params })
}

/** 导出报表（返回文件流） */
export function exportReport(reportId) {
  return request.get(`/analysis/reports/${reportId}/export`, { responseType: 'blob' })
}

/** 长势与病虫害识别结果 */
export function getAiInsight(params) {
  return request.get('/analysis/ai-insight', { params })
}
