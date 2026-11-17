/**
 * 农事接口封装（A11 / A12）
 * 计划派单后生成工单；移动端农事打卡按「工单 + 日期」唯一，重复打卡返回 40901。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A11 农事计划列表 · P015/P016 */
export const fetchFarmPlans = (params) => request.get('/farm/plans', { params })

/** A11 新建农事计划 · P015 */
export const createFarmPlan = (payload) => request.post('/farm/plans', payload, writeConfig())

/** A11 计划派单（按工人生成工单） · P015/P016 */
export const dispatchFarmPlan = (id, payload) =>
  request.post(`/farm/plans/${id}/dispatch`, payload, writeConfig())

/** 扩展 工单列表（P016 农事工单页） · P016 */
export const fetchFarmTasks = (params) => request.get('/farm/tasks', { params })

/** 扩展 工单状态流转（完成/取消） · P016 */
export const updateFarmTaskStatus = (id, payload) =>
  request.post(`/farm/tasks/${id}/status`, payload, writeConfig())

/** A12 农事打卡记录 · P016/M002 */
export const fetchFarmRecords = (params) => request.get('/farm/records', { params })

/** A12 农事打卡（body: { taskId, content, photos, location }） · M002/P016 */
export const createFarmRecord = (payload) => request.post('/farm/records', payload, writeConfig())
