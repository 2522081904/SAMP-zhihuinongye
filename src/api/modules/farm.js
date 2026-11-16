/**
 * 农事与农资接口（模块：农事管理）
 */
import request from '@/api/request'

/** 农事计划分页列表 */
export function getPlanPage(params) {
  return request.get('/farm/plans', { params })
}

/** 农事工单分页列表 */
export function getTaskPage(params) {
  return request.get('/farm/tasks', { params })
}

/** 农资档案分页列表 */
export function getInputPage(params) {
  return request.get('/farm/inputs', { params })
}

/** 农资出入库台账分页列表 */
export function getInputLedgerPage(params) {
  return request.get('/farm/inputs/ledger', { params })
}

/** 库存与低库存预警列表 */
export function getInventoryList(params) {
  return request.get('/farm/inputs/inventory', { params })
}

/** 采收批次登记 */
export function createHarvestBatch(data) {
  return request.post('/farm/harvest', data)
}
