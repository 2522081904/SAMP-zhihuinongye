/**
 * 溯源与检测接口封装（A16 / A17 / A18）
 * A17 为公开接口：扫码页免登录调用，即使本地令牌失效也必须放行。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A16 溯源码列表 · P021/P022 */
export const fetchTraceCodes = (params) => request.get('/trace/codes', { params })

/** A16 批量生成溯源码（body: { batchId, count }，单次 1~100 个） · P021/P022 */
export const generateTraceCodes = (payload) => request.post('/trace/codes', payload, writeConfig())

/** A17 公开溯源档案（免登录，按溯源码查询） · M003/P022 */
export const fetchPublicTrace = (code) => request.get(`/trace/public/${code}`)

/** A18 检测报告列表 · P022/P023 */
export const fetchInspections = (params) => request.get('/trace/inspections', { params })

/** A18 新增检测报告（自动判定合格结论并回写批次状态） · P022/P023 */
export const createInspection = (payload) =>
  request.post('/trace/inspections', payload, writeConfig())

/** 扩展 检测报告详情 · P023 */
export const fetchInspectionDetail = (id) => request.get(`/trace/inspections/${id}`)

/** 扩展 批次下的溯源码清单 · P021 */
export const fetchBatchTraceCodes = (batchNo) => request.get(`/trace/batches/${batchNo}/codes`)
