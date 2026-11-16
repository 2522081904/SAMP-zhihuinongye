/**
 * 质量溯源接口（模块：质量溯源）
 */
import request from '@/api/request'

/** 溯源批次分页列表 */
export function getTraceBatchPage(params) {
  return request.get('/trace/batches', { params })
}

/** 批次溯源详情（消费者扫码查询同样走此接口） */
export function getTraceDetail(batchCode) {
  return request.get(`/trace/batches/${batchCode}`)
}

/** 保存溯源信息编辑内容 */
export function updateTraceInfo(batchCode, data) {
  return request.put(`/trace/batches/${batchCode}`, data)
}

/** 检测报告分页列表 */
export function getLabReportPage(params) {
  return request.get('/trace/lab-reports', { params })
}
