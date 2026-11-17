/**
 * GIS 地块模块 mock handler（A10）
 * 负责地块列表、地块边界读取与更新、空间统计（供 P024 一张图使用）。
 */
import { computePolygonAreaMu, findPlot, plots } from '../db.js'
import {
  fail,
  formatDateTime,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue,
  round
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

/**
 * 校验边界点数组：至少 3 个点，每个点为 [经度, 纬度] 且落在国内合理范围。
 * @param {*} boundary 边界点数组
 * @returns {string} 校验失败时的提示文案；通过时返回空串
 */
function validateBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return '边界至少需要 3 个坐标点'
  }
  for (const point of boundary) {
    if (!Array.isArray(point) || point.length < 2) {
      return '边界点格式应为 [经度, 纬度]'
    }
    const [lng, lat] = point.map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return '边界点坐标必须为数字'
    }
    if (lng < 73 || lng > 136 || lat < 3 || lat > 54) {
      return '边界点坐标超出国内合理范围'
    }
  }
  return ''
}

/**
 * 组装地块边界返回结构。
 * @param {Object} plot 地块
 * @returns {Object} 边界信息
 */
function boundaryPayload(plot) {
  return {
    plotId: plot.id,
    plotName: plot.name,
    crop: plot.crop,
    areaMu: plot.areaMu,
    center: plot.center,
    boundary: plot.boundary,
    updatedAt: plot.updatedAt,
    updatedBy: plot.updatedBy
  }
}

/**
 * GIS 模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleGis(ctx) {
  const { method, path, query } = ctx

  // 扩展：地块列表（P014 地块管理、P024 一张图左侧列表使用）
  if (method === 'GET' && matchPath(path, '/gis/plots')) {
    const keyword = queryValue(query, 'keyword')
    const crop = queryValue(query, 'crop')
    const greenhouse = queryValue(query, 'greenhouse')
    const list = plots.filter(
      (plot) =>
        (!crop || plot.crop === crop) &&
        (greenhouse === '' || String(plot.greenhouse) === greenhouse) &&
        matchKeyword([plot.id, plot.name, plot.crop, plot.variety, plot.manager], keyword)
    )
    return ok(paginate(list, query))
  }

  // A10 地块边界查询：GET /gis/plots/{id}/boundary
  const boundaryPath = matchPath(path, '/gis/plots/:id/boundary')
  if (method === 'GET' && boundaryPath) {
    const plot = findPlot(boundaryPath.id)
    if (!plot) {
      return fail(40401, `地块 ${boundaryPath.id} 不存在`)
    }
    return ok(boundaryPayload(plot))
  }

  // A10 地块边界更新：POST /gis/plots/{id}/boundary
  if (method === 'POST' && boundaryPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const plot = findPlot(boundaryPath.id)
    if (!plot) {
      return fail(40401, `地块 ${boundaryPath.id} 不存在`)
    }
    const body = ctx.body || {}
    const invalid = validateBoundary(body.boundary)
    if (invalid) {
      return fail(40001, invalid)
    }
    plot.boundary = body.boundary.map((point) => [Number(point[0]), Number(point[1])])
    plot.areaMu = round(computePolygonAreaMu(plot.boundary), 2)
    plot.updatedAt = formatDateTime(Date.now())
    plot.updatedBy = user.name
    return ok(boundaryPayload(plot), '地块边界已更新')
  }

  // 扩展：空间统计（P024 顶部指标卡与作物分布图使用）
  if (method === 'GET' && matchPath(path, '/gis/statistics')) {
    const byCrop = new Map()
    const byGreenhouse = { greenhouse: 0, openField: 0 }
    plots.forEach((plot) => {
      const current = byCrop.get(plot.crop) || { name: plot.crop, areaMu: 0, plotCount: 0 }
      current.areaMu = round(current.areaMu + plot.areaMu, 2)
      current.plotCount += 1
      byCrop.set(plot.crop, current)
      if (plot.greenhouse) {
        byGreenhouse.greenhouse += 1
      } else {
        byGreenhouse.openField += 1
      }
    })
    return ok({
      plotCount: plots.length,
      totalAreaMu: round(
        plots.reduce((sum, plot) => sum + plot.areaMu, 0),
        2
      ),
      byCrop: [...byCrop.values()].sort((left, right) => right.areaMu - left.areaMu),
      byGreenhouse: [
        { name: '设施温室', value: byGreenhouse.greenhouse },
        { name: '露地种植', value: byGreenhouse.openField }
      ]
    })
  }

  return null
}
