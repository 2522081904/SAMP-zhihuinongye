/**
 * GIS 地图接口（模块：GIS 一张图）
 */
import request from '@/api/request'

/** 地块列表（含 GeoJSON 边界） */
export function getPlotList(params) {
  return request.get('/gis/plots', { params })
}

/** 保存地块边界 */
export function savePlot(data) {
  return request.post('/gis/plots', data)
}

/** 空间统计（按作物、面积、产量聚合） */
export function getSpatialStatistics(params) {
  return request.get('/gis/statistics', { params })
}

/** 图层配置列表 */
export function getLayerList() {
  return request.get('/gis/layers')
}
