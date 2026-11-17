/**
 * 交易接口封装（A23 / A24）
 * 订单状态机：PENDING → PAID → SHIPPED → DONE，非法流转返回 40901。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A23 订单列表 · P027 */
export const fetchOrders = (params) => request.get('/trade/orders', { params })

/** A23 创建订单（body: { customerId, items: [{ goodsId, quantity }], remark }） · P027 */
export const createOrder = (payload) => request.post('/trade/orders', payload, writeConfig())

/** A23 订单详情 · P027 */
export const fetchOrderDetail = (id) => request.get(`/trade/orders/${id}`)

/** A23 订单收款 · P027 */
export const payOrder = (id, payload) =>
  request.post(`/trade/orders/${id}/pay`, payload, writeConfig())

/** A23 订单发货（未收款返回 40901） · P027 */
export const shipOrder = (id, payload) =>
  request.post(`/trade/orders/${id}/ship`, payload, writeConfig())

/** A24 商品列表 · P027 */
export const fetchGoods = (params) => request.get('/trade/goods', { params })

/** A24 新增商品 · P027 */
export const createGoods = (payload) => request.post('/trade/goods', payload, writeConfig())

/** A24 客户列表 · P027 */
export const fetchCustomers = (params) => request.get('/trade/customers', { params })

/** A24 新增客户（重名返回 40901） · P027 */
export const createCustomer = (payload) => request.post('/trade/customers', payload, writeConfig())
