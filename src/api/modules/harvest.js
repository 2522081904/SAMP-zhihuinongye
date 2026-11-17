/**
 * 采收接口封装（A15）
 * 批次是溯源码与检测报告的挂载主体。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A15 采收批次列表 · P020/P023 */
export const fetchHarvestBatches = (params) => request.get('/harvest/batches', { params })

/** A15 新建采收批次（batchNo 缺省自动生成，重复返回 40901） · P020 */
export const createHarvestBatch = (payload) =>
  request.post('/harvest/batches', payload, writeConfig())
