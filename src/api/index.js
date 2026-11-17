/**
 * 接口层统一出口
 * 页面统一从 '@/api' 引入接口函数，禁止在页面里写裸 URL。
 * 命名规则：fetchXxx 为查询，createXxx 为新增，updateXxx / saveXxx 为修改，
 * 动作类接口使用动词（login / sendCommand / handleAlarm / dispatchFarmPlan）。
 */
export * from './modules/auth.js'
export * from './modules/iot.js'
export * from './modules/ctl.js'
export * from './modules/gis.js'
export * from './modules/farm.js'
export * from './modules/supply.js'
export * from './modules/harvest.js'
export * from './modules/trace.js'
export * from './modules/alarm.js'
export * from './modules/analysis.js'
export * from './modules/trade.js'
export * from './modules/system.js'
export * from './modules/open.js'

export { default as request, TOKEN_KEY } from './request.js'
export { createRequestId, writeConfig } from './request-id.js'
