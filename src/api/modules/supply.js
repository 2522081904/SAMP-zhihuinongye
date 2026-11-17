/**
 * 农资接口封装（A13 / A14）
 * 出入库会实时改写库存状态（正常/偏低/缺货），出库超量返回 40901。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A13 农资库存列表 · P017 */
export const fetchStock = (params) => request.get('/supply/stock', { params })

/** A13 农资出入库（body: { itemId, type: 'IN'|'OUT', quantity, remark }） · P017 */
export const changeStock = (payload) => request.post('/supply/stock', payload, writeConfig())

/** 扩展 农资看板指标（库存总值、低库存数、分类分布） · P017 */
export const fetchStockStatistics = () => request.get('/supply/statistics')

/** A14 农药使用台账列表 · P018 */
export const fetchPesticideLogs = (params) => request.get('/supply/pesticide-logs', { params })

/** A14 新增农药使用台账（自动计算安全间隔期与采收截止日） · P018 */
export const createPesticideLog = (payload) =>
  request.post('/supply/pesticide-logs', payload, writeConfig())
