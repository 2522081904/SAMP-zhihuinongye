/**
 * GIS 地块接口封装（A10）
 * 地块边界为经纬度坐标数组，保存时会重算面积。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** 扩展 地块列表（P014 地块管理 / P024 一张图列表） · P014/P024 */
export const fetchPlots = (params) => request.get('/gis/plots', { params })

/** A10 地块边界查询 · P014/P024 */
export const fetchPlotBoundary = (id) => request.get(`/gis/plots/${id}/boundary`)

/** A10 保存地块边界（body: { boundary: [[lng, lat], ...] }） · P014/P024 */
export const updatePlotBoundary = (id, payload) =>
  request.post(`/gis/plots/${id}/boundary`, payload, writeConfig())

/** 扩展 空间统计（总面积、作物分布、设施/露地占比） · P024 */
export const fetchGisStatistics = () => request.get('/gis/statistics')
