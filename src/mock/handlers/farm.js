/**
 * 农事模块 mock handler（A11 / A12）
 * 负责农事计划、计划派单、工单列表，以及移动端农事打卡记录。
 */
import { farmPlans, findPlan, findPlot, findWorkOrder, runtime, workOrders, NOW_MS } from '../db.js'
import {
  fail,
  formatDate,
  formatDateTime,
  inTimeRange,
  isBlank,
  matchKeyword,
  matchPath,
  ok,
  paginate,
  queryValue,
  toInt
} from '../utils.js'
import { currentUser, unauthorized } from './auth.js'

// 工单状态字典
const TASK_STATUS_NAMES = {
  PENDING: '待执行',
  DOING: '进行中',
  DONE: '已完成',
  CANCELLED: '已取消'
}

/**
 * 农事模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleFarm(ctx) {
  const { method, path, query } = ctx

  // A11 农事计划列表：GET /farm/plans
  if (method === 'GET' && matchPath(path, '/farm/plans')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const plotId = queryValue(query, 'plotId')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = farmPlans.filter(
      (plan) =>
        (!status || plan.status === status) &&
        (!plotId || plan.plotId === plotId) &&
        inTimeRange(plan.planDate, from, to) &&
        matchKeyword([plan.planNo, plan.title, plan.plotName, plan.owner, plan.crop], keyword)
    )
    return ok(paginate(list, query))
  }

  // A11 新建农事计划：POST /farm/plans
  if (method === 'POST' && matchPath(path, '/farm/plans')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const title = String(body.title || '').trim()
    const plotId = String(body.plotId || '').trim()
    const planDate = String(body.planDate || '').trim()
    if (isBlank(title) || isBlank(plotId) || isBlank(planDate)) {
      return fail(40001, '计划标题、地块与计划日期不能为空')
    }
    const plot = findPlot(plotId)
    if (!plot) {
      return fail(40401, `地块 ${plotId} 不存在`)
    }
    const id = farmPlans.reduce((max, plan) => Math.max(max, plan.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const plan = {
      id,
      planNo: `PL-${planDate.slice(0, 7).replace('-', '')}-${String(id).padStart(3, '0')}`,
      title,
      plotId: plot.id,
      plotName: plot.name,
      crop: plot.crop,
      planDate,
      startTime: String(body.startTime || '08:00'),
      endTime: String(body.endTime || '11:30'),
      status: 'DRAFT',
      statusName: '草稿',
      priority: String(body.priority || 'NORMAL'),
      owner: String(body.owner || user.name),
      workers: Array.isArray(body.workers) ? body.workers : [String(body.owner || user.name)],
      remark: String(body.remark || ''),
      createdAt: nowText,
      updatedAt: nowText
    }
    farmPlans.unshift(plan)
    return ok(plan, '农事计划已创建')
  }

  // A11 计划派单：POST /farm/plans/{id}/dispatch
  const dispatchPath = matchPath(path, '/farm/plans/:id/dispatch')
  if (method === 'POST' && dispatchPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const plan = findPlan(dispatchPath.id)
    if (!plan) {
      return fail(40401, `农事计划 ${dispatchPath.id} 不存在`)
    }
    if (plan.status !== 'DRAFT') {
      return fail(40901, '当前计划不是草稿状态，不能重复派单')
    }
    const body = ctx.body || {}
    const workers =
      Array.isArray(body.workers) && body.workers.length > 0 ? body.workers : plan.workers
    const baseId = workOrders.reduce((max, order) => Math.max(max, order.id), 0)
    const nowText = formatDateTime(NOW_MS)
    const tasks = workers.map((worker, index) => {
      const taskId = baseId + index + 1
      const task = {
        id: taskId,
        taskNo: `WO-${plan.planNo.slice(3)}-${String(taskId).padStart(3, '0')}`,
        planId: plan.id,
        planNo: plan.planNo,
        title: plan.title,
        plotId: plan.plotId,
        plotName: plan.plotName,
        crop: plan.crop,
        assignee: String(worker),
        assigneePhone: '',
        status: 'PENDING',
        statusName: TASK_STATUS_NAMES.PENDING,
        plannedAt: `${plan.planDate} ${plan.startTime}:00`,
        checkinAt: '',
        finishedAt: '',
        checkinLocation: '',
        content: plan.remark || `按作业规程完成${plan.title}`,
        createdAt: nowText
      }
      workOrders.unshift(task)
      return task
    })
    plan.status = 'DISPATCHED'
    plan.statusName = '已派单'
    plan.updatedAt = nowText
    return ok({ plan, tasks }, `已派发 ${tasks.length} 条工单`)
  }

  // 扩展：工单列表（P016 农事工单页使用）
  if (method === 'GET' && matchPath(path, '/farm/tasks')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const assignee = queryValue(query, 'assignee')
    const plotId = queryValue(query, 'plotId')
    const planId = queryValue(query, 'planId')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = workOrders
      .filter(
        (task) =>
          (!status || task.status === status) &&
          (!assignee || task.assignee === assignee) &&
          (!plotId || task.plotId === plotId) &&
          (!planId || String(task.planId) === planId) &&
          inTimeRange(task.plannedAt, from, to) &&
          matchKeyword([task.taskNo, task.title, task.plotName, task.assignee], keyword)
      )
      .sort((left, right) => String(right.plannedAt).localeCompare(String(left.plannedAt)))
    return ok(paginate(list, query))
  }

  // 扩展：工单状态流转（P016 完成/取消工单）
  const taskStatusPath = matchPath(path, '/farm/tasks/:id/status')
  if (method === 'POST' && taskStatusPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const task = findWorkOrder(taskStatusPath.id)
    if (!task) {
      return fail(40401, `工单 ${taskStatusPath.id} 不存在`)
    }
    const status = String((ctx.body || {}).status || '')
      .trim()
      .toUpperCase()
    if (!TASK_STATUS_NAMES[status]) {
      return fail(40001, `不支持的工单状态：${status}`)
    }
    if (task.status === 'DONE' || task.status === 'CANCELLED') {
      return fail(40901, '该工单已结束，不能再变更状态')
    }
    task.status = status
    task.statusName = TASK_STATUS_NAMES[status]
    if (status === 'DONE') {
      task.finishedAt = formatDateTime(NOW_MS)
    }
    return ok(task, '工单状态已更新')
  }

  // A12 农事打卡记录列表：GET /farm/records
  if (method === 'GET' && matchPath(path, '/farm/records')) {
    const keyword = queryValue(query, 'keyword')
    const plotId = queryValue(query, 'plotId')
    const operator = queryValue(query, 'operator')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = runtime.farmRecords
      .filter(
        (record) =>
          (!plotId || record.plotId === plotId) &&
          (!operator || record.operator === operator) &&
          inTimeRange(record.checkedAt, from, to) &&
          matchKeyword([record.taskNo, record.plotName, record.content, record.operator], keyword)
      )
      .sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt)))
    return ok(paginate(list, query))
  }

  // A12 农事打卡：POST /farm/records
  if (method === 'POST' && matchPath(path, '/farm/records')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const taskId = toInt(body.taskId, 0)
    const content = String(body.content || '').trim()
    if (!taskId || isBlank(content)) {
      return fail(40001, 'taskId 与打卡内容不能为空')
    }
    const task = findWorkOrder(taskId)
    if (!task) {
      return fail(40401, `工单 ${taskId} 不存在`)
    }
    const today = formatDate(NOW_MS)
    const checkinKey = `${taskId}-${today}`
    if (runtime.checkinKeys.has(checkinKey)) {
      return fail(40901, '该工单今日已打卡，请勿重复提交')
    }
    runtime.checkinKeys.add(checkinKey)
    const nowText = formatDateTime(NOW_MS)
    const record = {
      id: runtime.farmRecords.length + 1,
      taskId: task.id,
      taskNo: task.taskNo,
      planNo: task.planNo,
      plotId: task.plotId,
      plotName: task.plotName,
      crop: task.crop,
      content,
      photos: Array.isArray(body.photos) ? body.photos : [],
      location: String(body.location || ''),
      operator: user.name,
      checkedAt: nowText,
      createdAt: nowText
    }
    runtime.farmRecords.unshift(record)
    task.status = 'DOING'
    task.statusName = TASK_STATUS_NAMES.DOING
    task.checkinAt = nowText
    task.checkinLocation = record.location
    return ok(record, '打卡成功')
  }

  return null
}
