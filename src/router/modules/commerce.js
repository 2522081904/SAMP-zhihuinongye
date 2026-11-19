/**
 * 电商与客户模块路由（订单管理、商品与客户档案）
 */
export default [
  {
    path: '/commerce/orders',
    name: 'CommerceOrderList',
    component: () => import('@/views/commerce/OrderList.vue'),
    meta: {
      perm: 'trade:order:view',
      title: '订单管理',
      pageId: 'P027',
      module: '产销对接与订单',
      icon: 'ShoppingCart'
    }
  },
  {
    path: '/commerce/products',
    name: 'CommerceProductList',
    component: () => import('@/views/commerce/ProductList.vue'),
    meta: {
      perm: 'trade:goods:view',
      title: '商品与客户档案',
      pageId: 'P028',
      module: '产销对接与订单',
      icon: 'Goods'
    }
  }
]
