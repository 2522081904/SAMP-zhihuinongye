/**
 * 交易模块 mock handler（A23 / A24）
 * 负责订单查询与创建、发货与收款、商品与客户维护。
 */
import { customers, findCustomer, findGoods, goodsList, NOW_MS, orders } from '../db.js'
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
  round,
  toInt
} from '../utils.js'
import { currentUser, requireAdmin, unauthorized } from './auth.js'

// 订单状态字典
const ORDER_STATUS = {
  PENDING: '待付款',
  PAID: '待发货',
  SHIPPED: '已发货',
  DONE: '已完成',
  CANCELLED: '已取消'
}

/**
 * 交易模块路由入口。
 * @param {Object} ctx 请求上下文
 * @returns {Object|null} 响应信封；未匹配返回 null
 */
export function handleTrade(ctx) {
  const { method, path, query } = ctx

  // A23 订单列表：GET /trade/orders
  if (method === 'GET' && matchPath(path, '/trade/orders')) {
    const keyword = queryValue(query, 'keyword')
    const status = queryValue(query, 'status')
    const customerId = queryValue(query, 'customerId')
    const from = queryValue(query, 'from')
    const to = queryValue(query, 'to')
    const list = orders
      .filter(
        (order) =>
          (!status || order.status === status) &&
          (!customerId || String(order.customerId) === customerId) &&
          inTimeRange(order.createdAt, from, to) &&
          matchKeyword([order.orderNo, order.customerName, order.contact, order.phone], keyword)
      )
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    return ok(paginate(list, query))
  }

  // A23 创建订单：POST /trade/orders
  if (method === 'POST' && matchPath(path, '/trade/orders')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const customerKey = String(body.customerId ?? '').trim()
    if (isBlank(customerKey)) {
      return fail(40001, '缺少客户 customerId')
    }
    const customer = findCustomer(customerKey)
    if (!customer) {
      return fail(40401, `客户 ${customerKey} 不存在`)
    }
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      return fail(40001, '订单明细不能为空')
    }
    const items = []
    for (const raw of rawItems) {
      const goods = findGoods(raw.goodsId ?? raw.code)
      if (!goods) {
        return fail(40401, `商品 ${raw.goodsId ?? raw.code} 不存在`)
      }
      const quantity = toInt(raw.quantity, 0)
      if (quantity <= 0) {
        return fail(40001, `商品 ${goods.name} 的订购数量必须大于 0`)
      }
      items.push({
        goodsId: goods.id,
        goodsName: goods.name,
        spec: goods.spec,
        unit: goods.unit,
        quantity,
        unitPrice: goods.price,
        amount: round(goods.price * quantity, 2)
      })
    }
    const totalAmount = round(
      items.reduce((sum, item) => sum + item.amount, 0),
      2
    )
    const id = orders.reduce((max, order) => Math.max(max, order.id), 0) + 1
    const nowText = formatDateTime(NOW_MS)
    const order = {
      id,
      orderNo: `SO-${formatDate(NOW_MS).replace(/-/g, '')}-${String(id).padStart(3, '0')}`,
      customerId: customer.id,
      customerName: customer.name,
      contact: customer.contact,
      phone: customer.phone,
      address: customer.address,
      items,
      totalAmount,
      status: 'PENDING',
      statusName: ORDER_STATUS.PENDING,
      payMethod: String(body.payMethod || 'WECHAT'),
      createdAt: nowText,
      paidAt: '',
      shippedAt: '',
      logisticsNo: '',
      remark: String(body.remark || '')
    }
    orders.unshift(order)
    customer.orderCount += 1
    customer.totalAmount = round(customer.totalAmount + totalAmount, 2)
    return ok(order, '订单已创建')
  }

  // A23 订单详情：GET /trade/orders/{id}
  const orderPath = matchPath(path, '/trade/orders/:id')
  if (method === 'GET' && orderPath) {
    const order = orders.find((item) => String(item.id) === String(orderPath.id))
    if (!order) {
      return fail(40401, `订单 ${orderPath.id} 不存在`)
    }
    return ok(order)
  }

  // A23 订单收款：POST /trade/orders/{id}/pay
  const payPath = matchPath(path, '/trade/orders/:id/pay')
  if (method === 'POST' && payPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const order = orders.find((item) => String(item.id) === String(payPath.id))
    if (!order) {
      return fail(40401, `订单 ${payPath.id} 不存在`)
    }
    if (order.status !== 'PENDING') {
      return fail(40901, '当前订单不是待付款状态，不能重复收款')
    }
    order.status = 'PAID'
    order.statusName = ORDER_STATUS.PAID
    order.paidAt = formatDateTime(NOW_MS)
    return ok(order, '收款已确认')
  }

  // A23 订单发货：POST /trade/orders/{id}/ship
  const shipPath = matchPath(path, '/trade/orders/:id/ship')
  if (method === 'POST' && shipPath) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const order = orders.find((item) => String(item.id) === String(shipPath.id))
    if (!order) {
      return fail(40401, `订单 ${shipPath.id} 不存在`)
    }
    if (order.status !== 'PAID') {
      return fail(40901, '当前订单未收款，不能发货')
    }
    order.status = 'SHIPPED'
    order.statusName = ORDER_STATUS.SHIPPED
    order.shippedAt = formatDateTime(NOW_MS)
    order.logisticsNo = String(
      (ctx.body || {}).logisticsNo || `SF${String(order.id).padStart(10, '0')}`
    )
    return ok(order, '发货成功')
  }

  // A24 商品列表：GET /trade/goods
  if (method === 'GET' && matchPath(path, '/trade/goods')) {
    const keyword = queryValue(query, 'keyword')
    const category = queryValue(query, 'category')
    const status = queryValue(query, 'status')
    const list = goodsList.filter(
      (goods) =>
        (!category || goods.category === category) &&
        (!status || goods.status === status) &&
        matchKeyword([goods.code, goods.name, goods.spec, goods.categoryName], keyword)
    )
    return ok(paginate(list, query))
  }

  // A24 新增商品：POST /trade/goods
  if (method === 'POST' && matchPath(path, '/trade/goods')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const denied = requireAdmin(user)
    if (denied) {
      return denied
    }
    const body = ctx.body || {}
    const name = String(body.name || '').trim()
    const price = Number(body.price)
    if (isBlank(name) || !Number.isFinite(price) || price <= 0) {
      return fail(40001, '商品名称与销售单价不能为空')
    }
    const id = goodsList.reduce((max, goods) => Math.max(max, goods.id), 0) + 1
    const goods = {
      id,
      code: `SP-2026-${String(id).padStart(3, '0')}`,
      name,
      category: String(body.category || 'VEGETABLE'),
      categoryName: String(body.categoryName || '蔬菜'),
      spec: String(body.spec || '5kg/箱'),
      unit: String(body.unit || '箱'),
      price: round(price, 2),
      stock: toInt(body.stock, 0),
      status: 'ON_SALE',
      statusName: '在售',
      salesCount: 0,
      createdAt: formatDateTime(NOW_MS)
    }
    goodsList.unshift(goods)
    return ok(goods, '商品已创建')
  }

  // A24 客户列表：GET /trade/customers
  if (method === 'GET' && matchPath(path, '/trade/customers')) {
    const keyword = queryValue(query, 'keyword')
    const level = queryValue(query, 'level')
    const list = customers.filter(
      (customer) =>
        (!level || customer.level === level) &&
        matchKeyword([customer.code, customer.name, customer.contact, customer.phone], keyword)
    )
    return ok(paginate(list, query))
  }

  // A24 新增客户：POST /trade/customers
  if (method === 'POST' && matchPath(path, '/trade/customers')) {
    const user = currentUser(ctx)
    if (!user) {
      return unauthorized()
    }
    const body = ctx.body || {}
    const name = String(body.name || '').trim()
    const contact = String(body.contact || '').trim()
    const phone = String(body.phone || '').trim()
    if (isBlank(name) || isBlank(contact) || isBlank(phone)) {
      return fail(40001, '客户名称、联系人与联系电话不能为空')
    }
    if (customers.some((customer) => customer.name === name)) {
      return fail(40901, `客户 ${name} 已存在，请勿重复建档`)
    }
    const id = customers.reduce((max, customer) => Math.max(max, customer.id), 0) + 1
    const customer = {
      id,
      code: `CUS-2026-${String(id).padStart(3, '0')}`,
      name,
      contact,
      phone,
      address: String(body.address || ''),
      level: String(body.level || 'NORMAL'),
      levelName: String(body.levelName || '普通客户'),
      orderCount: 0,
      totalAmount: 0,
      status: 'ENABLED',
      createdAt: formatDateTime(NOW_MS)
    }
    customers.unshift(customer)
    return ok(customer, '客户已建档')
  }

  return null
}
