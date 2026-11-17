/**
 * 分析与报表接口封装（A21 / A22）
 * 报表详情返回 { summary, charts: { trend, distribution, ranking } }，供 AgriChart 直接消费。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A21 AI 诊断记录列表 · P010/P012 */
export const fetchDiagnoses = (params) => request.get('/ai/diagnosis', { params })

/** A21 发起 AI 诊断（body: { plotId, diagnosisType, imageUrl }） · P010/P012 */
export const createDiagnosis = (payload) => request.post('/ai/diagnosis', payload, writeConfig())

/** A22 报表列表 · P010/P011 */
export const fetchReports = (params) => request.get('/reports', { params })

/** A22 生成报表（body: { type, name, period }） · P010/P011 */
export const createReport = (payload) => request.post('/reports', payload, writeConfig())

/** A22 报表详情（含图表聚合数据） · P010/P011 */
export const fetchReportDetail = (id) => request.get(`/reports/${id}`)
