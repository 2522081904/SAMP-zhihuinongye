#!/usr/bin/env node
/**
 * 假数据层自检脚本（不依赖测试框架、不启服务器）
 * 直接调用 axios mock adapter 的请求分发函数，遍历 A01–A26 主路径并校验：
 *   1. 26 条主路径全部命中（code=0）；
 *   2. 分页接口 page/size/total/list 自洽；
 *   3. 40001 / 40101 / 40901 / 42301 四类错误可复现；
 *   4. A05 指令回执首次 PENDING、第二次 SUCCESS。
 * 运行：node scripts/mock-smoke.mjs
 */
import { handleMockRequest } from '../src/mock/adapter.js'
import {
  alarms,
  customers,
  devices,
  goodsList,
  harvestBatches,
  openApps,
  orders,
  reports,
  resetRuntime,
  roles,
  setSafetyLock,
  traceCodes,
  users,
  workOrders
} from '../src/mock/db.js'
import { createRequestId } from '../src/api/request-id.js'

let TOKEN = ''
let failureCount = 0
const rows = []
const extras = []

/**
 * 记录一条失败原因。
 * @param {string} message 失败描述
 */
function fail(message) {
  failureCount += 1
  console.error(`  ✗ ${message}`)
}

/**
 * 断言条件成立。
 * @param {boolean} condition 条件
 * @param {string} message 失败描述
 */
function assert(condition, message) {
  if (!condition) {
    fail(message)
  }
}

/**
 * 构造并分发一次 mock 请求。
 * @param {Object} options 请求描述
 * @returns {Object} 响应信封
 */
async function call(options) {
  const { method = 'GET', path, params, body, token = TOKEN, headers = {} } = options
  return await handleMockRequest({
    method,
    url: path,
    params,
    data: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

/**
 * 校验分页结构：list 长度与 total / page / size 自洽。
 * @param {Object} envelope 响应信封
 * @param {string} label 用例标签
 * @param {number} page 请求页码
 */
function assertPaged(envelope, label, page = 1) {
  const data = envelope.data || {}
  const pageNo = Number(data.page)
  const size = Number(data.size)
  const total = Number(data.total)
  const list = data.list
  if (!Number.isFinite(pageNo) || !Number.isFinite(size) || !Number.isFinite(total)) {
    fail(`${label} 分页字段缺失：${JSON.stringify(data).slice(0, 80)}`)
    return
  }
  if (!Array.isArray(list)) {
    fail(`${label} list 不是数组`)
    return
  }
  if (pageNo !== page || size < 1 || size > 100 || total < 0) {
    fail(`${label} 分页字段非法：page=${pageNo} size=${size} total=${total}`)
    return
  }
  const expected = Math.max(0, Math.min(size, total - (pageNo - 1) * size))
  if (list.length !== expected) {
    fail(`${label} list 长度 ${list.length} 与 total=${total} page=${page} size=${size} 不自洽`)
  }
}

/**
 * 记录主路径结果到表格。
 * @param {Object} item 用例结果
 */
function record(item) {
  const data = item.envelope.data
  const total =
    data && typeof data === 'object'
      ? (data.total ?? (Array.isArray(data) ? data.length : data.list?.length))
      : '-'
  const passed = item.envelope.code === 0
  if (!passed) {
    fail(
      `${item.id} ${item.method} ${item.path} 返回 code=${item.envelope.code} ${item.envelope.message}`
    )
  }
  rows.push({
    id: item.id,
    method: item.method,
    path: item.path,
    status: passed ? 'PASS' : 'FAIL',
    code: item.envelope.code,
    total: total === undefined ? '-' : total
  })
}

/**
 * 记录补充校验结果（不计入 26 条主路径）。
 * @param {string} label 用例名
 * @param {Object} envelope 响应信封
 * @param {number} expectedCode 期望业务码
 */
function recordExtra(label, envelope, expectedCode = 0) {
  const passed = envelope.code === expectedCode
  if (!passed) {
    fail(`补充校验「${label}」期望 code=${expectedCode}，实际 ${envelope.code} ${envelope.message}`)
  }
  extras.push({ label, code: envelope.code, passed })
}

/**
 * 打印对齐表格。
 * @param {Array<string>} headers 表头
 * @param {Array<Array>} body 表格内容
 */
function printTable(headers, body) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...body.map((row) => String(row[index]).length))
  )
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell).padEnd(widths[index] + 2, ' '))
      .join('')
      .trimEnd()
  console.log(line(headers))
  console.log(widths.map((width) => '-'.repeat(width + 2)).join(''))
  body.forEach((row) => console.log(line(row)))
}

resetRuntime()
TOKEN = ''

// ---------- A01 登录 ----------
const loginEnvelope = await call({
  method: 'POST',
  path: '/auth/login',
  body: { username: 'admin', password: 'Agri@2026' },
  token: ''
})
record({ id: 'A01', method: 'POST', path: '/auth/login', envelope: loginEnvelope })
TOKEN = loginEnvelope.data?.token || ''
assert(Boolean(TOKEN), 'A01 未返回 token')
assert(
  Array.isArray(loginEnvelope.data?.userInfo?.perms) &&
    loginEnvelope.data.userInfo.perms.includes('*'),
  'A01 管理员 perms 应为 ["*"]'
)

// ---------- A02 当前用户 ----------
record({ id: 'A02', method: 'GET', path: '/auth/me', envelope: await call({ path: '/auth/me' }) })

// ---------- A03 设备台账 ----------
const deviceList = await call({
  path: '/iot/devices',
  params: { page: 2, size: 5, status: 'ONLINE' }
})
record({ id: 'A03', method: 'GET', path: '/iot/devices?page=2&size=5', envelope: deviceList })
assertPaged(deviceList, 'A03 设备列表', 2)
const deviceDetail = await call({ path: `/iot/devices/${devices[0].code}` })
recordExtra('A03 设备详情', deviceDetail)
recordExtra('A03 设备不存在 → 40401', await call({ path: '/iot/devices/EQ-NOT-EXIST' }), 40401)
recordExtra('A03 越界页码返回空列表', await call({ path: '/iot/devices', params: { page: 999 } }))
assertPaged(await call({ path: '/iot/devices', params: { page: 999 } }), 'A03 越界页', 999)

// ---------- A04 / A05 指令下发与回执 ----------
const commandRequestId = createRequestId('REQ-SMOKE')
const commandEnvelope = await call({
  method: 'POST',
  path: '/ctl/commands',
  body: { deviceCode: devices.find((device) => device.category === 'ACTUATOR').code, action: 'ON' },
  headers: { 'X-Request-Id': commandRequestId }
})
record({ id: 'A04', method: 'POST', path: '/ctl/commands', envelope: commandEnvelope })
assert(commandEnvelope.data?.status === 'PENDING', 'A04 首次下发状态应为 PENDING')

const receiptFirst = await call({ path: `/ctl/commands/${commandRequestId}` })
const receiptSecond = await call({ path: `/ctl/commands/${commandRequestId}` })
assert(receiptFirst.data?.status === 'PENDING', 'A05 首次查询应为 PENDING')
assert(receiptSecond.data?.status === 'SUCCESS', 'A05 第二次查询应变为 SUCCESS')
record({
  id: 'A05',
  method: 'GET',
  path: `/ctl/commands/${commandRequestId}`,
  envelope: receiptSecond
})

// ---------- A06 / A07 实时与历史 ----------
record({
  id: 'A06',
  method: 'GET',
  path: '/iot/realtime?plotId=PLOT-01',
  envelope: await call({ path: '/iot/realtime', params: { plotId: 'PLOT-01' } })
})
const history = await call({
  path: '/iot/history',
  params: { deviceCode: devices[0].code, interval: 60 }
})
record({
  id: 'A07',
  method: 'GET',
  path: `/iot/history?deviceCode=${devices[0].code}&interval=60`,
  envelope: history
})
assert((history.data?.points || []).length > 0, 'A07 历史时序点不应为空')

// ---------- A08 策略 ----------
record({
  id: 'A08',
  method: 'GET',
  path: '/ctl/strategies',
  envelope: await call({ path: '/ctl/strategies', params: { page: 1, size: 10 } })
})
const newStrategy = await call({
  method: 'POST',
  path: '/ctl/strategies',
  body: {
    name: '低温自动补光',
    plotId: 'PLOT-02',
    metric: 'temperature',
    metricName: '空气温度',
    threshold: 15,
    duration: 10,
    action: 'OPEN_LIGHT',
    actionName: '开启补光灯'
  }
})
recordExtra('A08 新增策略', newStrategy)
recordExtra(
  'A08 修改策略',
  await call({
    method: 'PUT',
    path: `/ctl/strategies/${newStrategy.data?.id}`,
    body: { threshold: 14 }
  })
)

// ---------- A09 控制日志 ----------
const controlLogs = await call({ path: '/ctl/logs', params: { page: 1, size: 10 } })
record({ id: 'A09', method: 'GET', path: '/ctl/logs', envelope: controlLogs })
assertPaged(controlLogs, 'A09 控制日志')

// ---------- A10 地块边界 ----------
const boundary = await call({ path: '/gis/plots/PLOT-01/boundary' })
record({ id: 'A10', method: 'GET', path: '/gis/plots/PLOT-01/boundary', envelope: boundary })
assert((boundary.data?.boundary || []).length >= 3, 'A10 边界点不应少于 3 个')
recordExtra(
  'A10 保存边界',
  await call({
    method: 'POST',
    path: '/gis/plots/PLOT-01/boundary',
    body: { boundary: boundary.data.boundary }
  })
)

// ---------- A11 农事计划 ----------
const planList = await call({ path: '/farm/plans', params: { page: 1, size: 10 } })
record({ id: 'A11', method: 'GET', path: '/farm/plans', envelope: planList })
assertPaged(planList, 'A11 农事计划')
const newPlan = await call({
  method: 'POST',
  path: '/farm/plans',
  body: {
    title: '番茄疏果',
    plotId: 'PLOT-01',
    planDate: '2026-11-18',
    workers: ['张桂芳', '刘志强']
  }
})
recordExtra('A11 新建计划', newPlan)
const dispatch = await call({
  method: 'POST',
  path: `/farm/plans/${newPlan.data?.id}/dispatch`,
  body: { workers: ['张桂芳', '刘志强'] }
})
recordExtra('A11 计划派单', dispatch)
assert((dispatch.data?.tasks || []).length === 2, 'A11 派单应为每位工人生成一条工单')
recordExtra(
  'A11 重复派单 → 40901',
  await call({ method: 'POST', path: `/farm/plans/${newPlan.data?.id}/dispatch`, body: {} }),
  40901
)

// ---------- A12 农事打卡 ----------
const pendingTask = workOrders.find((task) => task.status === 'PENDING')
record({
  id: 'A12',
  method: 'POST',
  path: '/farm/records',
  envelope: await call({
    method: 'POST',
    path: '/farm/records',
    body: {
      taskId: pendingTask.id,
      content: '完成整枝打杈并清理病叶',
      photos: ['https://cdn.agri.example.com/checkin/001.jpg'],
      location: '一号连栋温室东侧入口'
    }
  })
})
recordExtra(
  'A12 重复打卡 → 40901',
  await call({
    method: 'POST',
    path: '/farm/records',
    body: { taskId: pendingTask.id, content: '重复提交' }
  }),
  40901
)
recordExtra('A12 打卡记录列表', await call({ path: '/farm/records', params: { page: 1 } }))

// ---------- A13 农资库存 ----------
const stockList = await call({ path: '/supply/stock', params: { page: 1, size: 10 } })
record({ id: 'A13', method: 'GET', path: '/supply/stock', envelope: stockList })
assertPaged(stockList, 'A13 库存')
const stockChange = await call({
  method: 'POST',
  path: '/supply/stock',
  body: { itemId: 'AG-2026-001', type: 'IN', quantity: 5, remark: '自检入库' }
})
recordExtra('A13 入库', stockChange)
recordExtra(
  'A13 出库超量 → 40901',
  await call({
    method: 'POST',
    path: '/supply/stock',
    body: { itemId: 'AG-2026-001', type: 'OUT', quantity: 99999 }
  }),
  40901
)

// ---------- A14 农药台账 ----------
const pesticideList = await call({ path: '/supply/pesticide-logs', params: { page: 1, size: 10 } })
record({ id: 'A14', method: 'GET', path: '/supply/pesticide-logs', envelope: pesticideList })
assertPaged(pesticideList, 'A14 农药台账')
const newPesticide = await call({
  method: 'POST',
  path: '/supply/pesticide-logs',
  body: {
    pesticideName: '苏云金杆菌悬浮剂',
    plotId: 'PLOT-02',
    appliedAt: '2026-11-17 08:00:00',
    dose: 40,
    unit: 'ml/亩',
    safeIntervalDays: 5,
    dilution: '500 倍液'
  }
})
recordExtra('A14 新增台账', newPesticide)
assert(Boolean(newPesticide.data?.withdrawEndDate), 'A14 应自动计算安全间隔期截止日')

// ---------- A15 采收批次 ----------
const batchList = await call({ path: '/harvest/batches', params: { page: 1, size: 10 } })
record({ id: 'A15', method: 'GET', path: '/harvest/batches', envelope: batchList })
assertPaged(batchList, 'A15 采收批次')
const newBatch = await call({
  method: 'POST',
  path: '/harvest/batches',
  body: {
    plotId: 'PLOT-03',
    harvestDate: '2026-11-17',
    quantityKg: 260,
    grade: '一级',
    unitPrice: 5.8
  }
})
recordExtra('A15 新建批次', newBatch)
recordExtra(
  'A15 重复批次号 → 40901',
  await call({
    method: 'POST',
    path: '/harvest/batches',
    body: {
      plotId: 'PLOT-03',
      harvestDate: '2026-11-17',
      quantityKg: 100,
      batchNo: harvestBatches[0].batchNo
    }
  }),
  40901
)

// ---------- A16 溯源码 ----------
const traceList = await call({ path: '/trace/codes', params: { page: 1, size: 10 } })
record({ id: 'A16', method: 'GET', path: '/trace/codes', envelope: traceList })
assertPaged(traceList, 'A16 溯源码')
const newCodes = await call({
  method: 'POST',
  path: '/trace/codes',
  body: { batchId: harvestBatches[0].id, count: 2 }
})
recordExtra('A16 生成溯源码', newCodes)
assert((newCodes.data?.codes || []).length === 2, 'A16 应一次生成 2 个溯源码')

// ---------- A17 公开溯源（无效令牌也必须通） ----------
const publicTrace = await call({
  path: `/trace/public/${traceCodes[0].code}`,
  token: 'invalid-token-for-public'
})
record({
  id: 'A17',
  method: 'GET',
  path: `/trace/public/${traceCodes[0].code}`,
  envelope: publicTrace
})
assert((publicTrace.data?.timeline || []).length >= 3, 'A17 公开档案时间线应完整')
recordExtra(
  'A17 溯源码不存在 → 40401',
  await call({ path: '/trace/public/TRC-2026-999999', token: '' }),
  40401
)

// ---------- A18 检测报告 ----------
const inspectionList = await call({ path: '/trace/inspections', params: { page: 1, size: 10 } })
record({ id: 'A18', method: 'GET', path: '/trace/inspections', envelope: inspectionList })
assertPaged(inspectionList, 'A18 检测报告')
const newInspection = await call({
  method: 'POST',
  path: '/trace/inspections',
  body: {
    batchNo: harvestBatches[1].batchNo,
    inspectItems: [
      { name: '毒死蜱', value: 0.004, limit: 0.02, unit: 'mg/kg' },
      { name: '铅（Pb）', value: 0.03, limit: 0.1, unit: 'mg/kg' }
    ]
  }
})
recordExtra('A18 新增检测报告', newInspection)
assert(newInspection.data?.conclusion === 'PASS', 'A18 全部项目合格时结论应为 PASS')

// ---------- A19 告警列表 ----------
const alarmList = await call({ path: '/alarms', params: { page: 1, size: 10, status: 'PENDING' } })
record({ id: 'A19', method: 'GET', path: '/alarms?status=PENDING', envelope: alarmList })
assertPaged(alarmList, 'A19 告警')
const pendingAlarm = alarms.find((alarm) => alarm.status === 'PENDING')
recordExtra('A19 告警详情', await call({ path: `/alarms/${pendingAlarm.id}` }))

// ---------- A20 告警处置 ----------
record({
  id: 'A20',
  method: 'POST',
  path: `/alarms/${pendingAlarm.id}/handle`,
  envelope: await call({
    method: 'POST',
    path: `/alarms/${pendingAlarm.id}/handle`,
    body: { status: 'RESOLVED', remark: '已到现场处理并恢复通风' }
  })
})
recordExtra(
  'A20 重复处置 → 40901',
  await call({
    method: 'POST',
    path: `/alarms/${pendingAlarm.id}/handle`,
    body: { status: 'RESOLVED' }
  }),
  40901
)

// ---------- A21 AI 诊断 ----------
record({
  id: 'A21',
  method: 'GET',
  path: '/ai/diagnosis',
  envelope: await call({ path: '/ai/diagnosis', params: { page: 1, size: 10 } })
})
const diagnosis = await call({
  method: 'POST',
  path: '/ai/diagnosis',
  body: { plotId: 'PLOT-04', diagnosisType: 'DISEASE' }
})
recordExtra('A21 发起诊断', diagnosis)
assert(Boolean(diagnosis.data?.conclusion), 'A21 应返回诊断结论')

// ---------- A22 报表 ----------
const reportList = await call({ path: '/reports', params: { page: 1, size: 10 } })
record({ id: 'A22', method: 'GET', path: '/reports', envelope: reportList })
assertPaged(reportList, 'A22 报表')
const newReport = await call({
  method: 'POST',
  path: '/reports',
  body: { type: 'YIELD', name: '11 月产量自检报表', period: '2026-11' }
})
recordExtra('A22 生成报表', newReport)
const reportDetail = await call({ path: `/reports/${newReport.data?.id}` })
recordExtra('A22 报表详情', reportDetail)
assert(
  Boolean(reportDetail.data?.charts?.trend && reportDetail.data?.charts?.distribution),
  'A22 报表应返回趋势与分布图表数据'
)
assert(Number.isFinite(reports[0]?.id), 'A22 报表种子数据缺失')

// ---------- A23 订单 ----------
const orderList = await call({ path: '/trade/orders', params: { page: 1, size: 10 } })
record({ id: 'A23', method: 'GET', path: '/trade/orders', envelope: orderList })
assertPaged(orderList, 'A23 订单')
const newOrder = await call({
  method: 'POST',
  path: '/trade/orders',
  body: { customerId: customers[0].id, items: [{ goodsId: goodsList[0].id, quantity: 2 }] }
})
recordExtra('A23 创建订单', newOrder)
assert(newOrder.data?.totalAmount === goodsList[0].price * 2, 'A23 订单金额应按单价 × 数量汇总')
recordExtra(
  'A23 订单收款',
  await call({ method: 'POST', path: `/trade/orders/${newOrder.data?.id}/pay`, body: {} })
)
recordExtra(
  'A23 订单发货',
  await call({ method: 'POST', path: `/trade/orders/${newOrder.data?.id}/ship`, body: {} })
)
recordExtra(
  'A23 未收款直接发货 → 40901',
  await call({ method: 'POST', path: `/trade/orders/${orders[0].id}/ship`, body: {} }),
  40901
)

// ---------- A24 商品与客户 ----------
const goodsListEnvelope = await call({ path: '/trade/goods', params: { page: 1, size: 10 } })
record({ id: 'A24', method: 'GET', path: '/trade/goods', envelope: goodsListEnvelope })
assertPaged(goodsListEnvelope, 'A24 商品')
recordExtra('A24 客户列表', await call({ path: '/trade/customers', params: { page: 1 } }))
recordExtra(
  'A24 新增商品',
  await call({
    method: 'POST',
    path: '/trade/goods',
    body: { name: '水果黄瓜', price: 38, spec: '2.5kg/箱', stock: 80 }
  })
)
recordExtra(
  'A24 新增客户',
  await call({
    method: 'POST',
    path: '/trade/customers',
    body: { name: '苏州绿源生鲜超市', contact: '陈立', phone: '13905120088' }
  })
)
recordExtra(
  'A24 客户重名 → 40901',
  await call({
    method: 'POST',
    path: '/trade/customers',
    body: { name: customers[0].name, contact: '陈立', phone: '13905120088' }
  }),
  40901
)

// ---------- A25 用户与角色 ----------
const userList = await call({ path: '/system/users', params: { page: 1, size: 10 } })
record({ id: 'A25', method: 'GET', path: '/system/users', envelope: userList })
assertPaged(userList, 'A25 用户')
const roleList = await call({ path: '/system/roles', params: { page: 1, size: 10 } })
recordExtra('A25 角色列表', roleList)
assertPaged(roleList, 'A25 角色')
const newUser = await call({
  method: 'POST',
  path: '/system/users',
  body: { username: 'farmer04', name: '赵春梅', roleCode: 'FARMER', phone: '13805120104' }
})
recordExtra('A25 新增用户', newUser)
recordExtra(
  'A25 账号重复 → 40901',
  await call({
    method: 'POST',
    path: '/system/users',
    body: { username: users[0].username, name: '重复账号', roleCode: 'FARMER' }
  }),
  40901
)
recordExtra(
  'A25 修改角色返回更新后对象',
  await call({
    method: 'POST',
    path: '/system/roles',
    body: { id: roles[3].id, name: `${roles[3].name}（自检）`, perms: roles[3].perms }
  })
)
assert(users.length >= 8, 'A25 用户种子数据应不少于 8 个')

// ---------- A26 开放平台 ----------
const appList = await call({ path: '/open/apps', params: { page: 1, size: 10 } })
record({ id: 'A26', method: 'GET', path: '/open/apps', envelope: appList })
assertPaged(appList, 'A26 应用')
const enabledApp = openApps.find((app) => app.status === 'ENABLED')
const disabledApp = openApps.find((app) => app.status === 'DISABLED')
recordExtra(
  'A26 创建应用',
  await call({ method: 'POST', path: '/open/apps', body: { appName: '自检第三方系统' } })
)
const openToken = await call({
  method: 'POST',
  path: '/open/token',
  token: '',
  body: { appId: enabledApp.appId, appSecret: enabledApp.appSecret }
})
recordExtra('A26 换取令牌', openToken)
assert(Boolean(openToken.data?.accessToken), 'A26 应返回 accessToken')
recordExtra(
  'A26 错误密钥 → 40102',
  await call({
    method: 'POST',
    path: '/open/token',
    token: '',
    body: { appId: enabledApp.appId, appSecret: 'wrong-secret' }
  }),
  40102
)
recordExtra(
  'A26 已停用应用 → 42301',
  await call({
    method: 'POST',
    path: '/open/token',
    token: '',
    body: { appId: disabledApp.appId, appSecret: disabledApp.appSecret }
  }),
  42301
)

// ---------- 错误场景复现 ----------
console.log('\n【错误场景】')
// 说明：call() 已改为 async，所有响应必须先 await 出来再放进对象字面量（可读性也更好）。
const errorEnvelope40001 = await call({
  method: 'POST',
  path: '/auth/login',
  body: { username: '', password: '' },
  token: ''
})
const errorEnvelope40101 = await call({ path: '/auth/me', token: '' })

// 40901 重复提交：同一个 X-Request-Id 连发两次，第二次应被请求号去重拦截
const duplicateRequestId = createRequestId('REQ-DUP')
const duplicateFirst = await call({
  method: 'POST',
  path: '/ctl/commands',
  body: {
    deviceCode: devices.find((device) => device.category === 'ACTUATOR').code,
    action: 'OFF'
  },
  headers: { 'X-Request-Id': duplicateRequestId }
})
assert(duplicateFirst.code === 0, '40901 场景的前置下发应成功')
const errorEnvelope40901 = await call({
  method: 'POST',
  path: '/ctl/commands',
  body: {
    deviceCode: devices.find((device) => device.category === 'ACTUATOR').code,
    action: 'OFF'
  },
  headers: { 'X-Request-Id': duplicateRequestId }
})

// 42301 安全锁：开启安全锁后下发指令应被拦截，随后立刻复位避免影响其它用例
setSafetyLock(true)
const errorEnvelope42301 = await call({
  method: 'POST',
  path: '/ctl/commands',
  body: {
    deviceCode: devices.find((device) => device.category === 'ACTUATOR').code,
    action: 'ON'
  },
  headers: { 'X-Request-Id': createRequestId('REQ-LOCK') }
})
setSafetyLock(false)

const errorCases = [
  { label: '40001 参数校验失败', expected: 40001, envelope: errorEnvelope40001 },
  { label: '40101 未登录', expected: 40101, envelope: errorEnvelope40101 },
  { label: '40901 重复提交', expected: 40901, envelope: errorEnvelope40901 },
  { label: '42301 安全锁开启', expected: 42301, envelope: errorEnvelope42301 },
  // 密码相关错误场景（TASK-1）：错误密码 / 未知账号都必须返回同一个 40102，不能泄漏账号是否存在
  {
    label: '40102 密码错误',
    expected: 40102,
    envelope: await call({
      method: 'POST',
      path: '/auth/login',
      body: { username: 'admin', password: 'Wrong@2026' },
      token: ''
    })
  },
  {
    label: '40102 未知账号',
    expected: 40102,
    envelope: await call({
      method: 'POST',
      path: '/auth/login',
      body: { username: 'ghost-user', password: 'Agri@2026' },
      token: ''
    })
  }
]

errorCases.forEach((item) => {
  const passed = item.envelope.code === item.expected
  if (!passed) {
    fail(`错误场景「${item.label}」期望 ${item.expected}，实际 ${item.envelope.code}`)
  }
  console.log(
    `  ${passed ? '✓' : '✗'} ${item.label} → code=${item.envelope.code} ${item.envelope.message}`
  )
})

// ---------- 输出 ----------
console.log('\n【A01–A26 主路径自检】')
printTable(
  ['编号', '方法', '路径', '状态', 'code', 'total'],
  rows.map((row) => [row.id, row.method, row.path, row.status, row.code, row.total])
)

const uniqueIds = new Set(rows.map((row) => row.id))
assert(rows.length === 26, `主路径应覆盖 26 条，实际 ${rows.length} 条`)
assert(uniqueIds.size === 26, `A 编号应唯一覆盖 26 个，实际 ${uniqueIds.size} 个`)
assert(failureCount === 0, `共 ${failureCount} 项断言失败`)

console.log('\n【补充校验】')
printTable(
  ['用例', 'code', '结果'],
  extras.map((item) => [item.label, item.code, item.passed ? 'PASS' : 'FAIL'])
)

if (failureCount === 0) {
  console.log(
    `\n全部通过：26 条主路径 + ${extras.length} 项补充校验 + ${errorCases.length} 类错误场景`
  )
  process.exitCode = 0
} else {
  console.error(`\n自检失败：${failureCount} 项未通过`)
  process.exitCode = 1
}
