/**
 * 订单与商品接口（模块：电商与客户）
 */
import request from '@/api/request'

/** 订单分页列表 */
export function getOrderPage(params) {
  return request.get('/commerce/orders', { params })
}

/** 商品分页列表 */
export function getProductPage(params) {
  return request.get('/commerce/products', { params })
}

/** 客户档案分页列表 */
export function getCustomerPage(params) {
  return request.get('/commerce/customers', { params })
}
