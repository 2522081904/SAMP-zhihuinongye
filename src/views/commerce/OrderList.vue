<script setup>
/**
 * P027 订单管理
 * 数据来源：A23 销售订单（GET /trade/orders、POST /trade/orders、GET /trade/orders/{id}、
 *           POST /trade/orders/{id}/ship）、A24 商品与客户（GET /trade/goods、GET /trade/customers）。
 * 数据缺口与落地口径：
 * - A23 没有「取消订单」接口：取消结果记在 sessionStorage（agri-commerce-overrides-v1），
 *   仅本机可见，刷新不丢、换浏览器还原；发货走真实接口，成功后统一回源刷新，不做本地叠加；
 * - A23 列表的 keyword 只匹配订单号 / 客户 / 联系人 / 电话，不匹配商品名，
 *   因此一次性拉全量（size=100）后在前端统一过滤与分页（与 P019、P023 同口径）；
 * - A23 创建订单的 body 不接收收货地址，落库地址取客户档案地址，页面保留输入并在说明中提示；
 * - 没有订单统计接口，4 张指标卡由全量订单在前端聚合，「本月」按 2026-11 口径；
 * - 状态下拉与表格都传业务态 map，AgriStatusTag 内置映射不含订单态。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { createOrder, fetchCustomers, fetchGoods, fetchOrders, shipOrder } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'CommerceOrderListPage' })

// 业务时间：mock 世界固定「现在」，本月口径与时间线文案都基于它
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)

// 本地覆盖存储：A23 缺失的「取消订单」结果暂存在这里（见文件头说明）
const OVERRIDE_KEY = 'agri-commerce-overrides-v1'

// 订单状态：待付款 → 待发货 → 已发货 → 已完成，取消为终止态
const ORDER_STATUS_MAP = {
  PENDING: { text: '待付款', type: 'warning' },
  PAID: { text: '待发货', type: 'primary' },
  SHIPPED: { text: '已发货', type: 'info' },
  DONE: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' }
}

// 支付方式字典（A23 返回 WECHAT / ALIPAY / TRANSFER）
const PAY_METHOD_MAP = {
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  TRANSFER: '银行转账'
}

const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS_MAP).map(([value, item]) => ({
  value,
  label: item.text
}))

// 数据与三态
const orders = ref([])
const customers = ref([])
const goods = ref([])
const loading = ref(false)
const loadError = ref(false)

// 列表分页：一次性拉全量后前端分页
const page = ref(1)
const size = ref(10)

// 查询条件：与 AgriSearchBar 的字段 prop 一一对应
const orderQuery = ref({ keyword: '', status: '', dateRange: [], customerId: '' })

// 本地覆盖（仅订单取消）
const overrides = ref({ orders: {}, goods: {}, customers: {} })

// 新建订单弹窗
const orderVisible = ref(false)
const orderSubmitting = ref(false)
const orderDialogRef = ref(null)
const selectedGoods = ref(null)

// 详情抽屉
const detailVisible = ref(false)
const detailRow = ref(null)

/**
 * 读取本地覆盖（解析失败时退回空结构，避免脏数据让页面白屏）。
 */
function loadOverrides() {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    overrides.value = {
      orders: parsed?.orders || {},
      goods: parsed?.goods || {},
      customers: parsed?.customers || {}
    }
  } catch {
    overrides.value = { orders: {}, goods: {}, customers: {} }
  }
}

/**
 * 写回本地覆盖（隐私模式不可写时只保留内存态）。
 */
function persistOverrides() {
  try {
    sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides.value))
  } catch {
    // 忽略写入失败，页面仍以内存态展示
  }
}

/**
 * 保存单个订单的覆盖字段。
 * @param {number|string} id 订单 id
 * @param {Object} patch 覆盖字段
 */
function saveOrderOverride(id, patch) {
  const key = String(id)
  overrides.value.orders[key] = { ...overrides.value.orders[key], ...patch }
  persistOverrides()
}

/**
 * 把订单覆盖合并进接口返回的行。
 * mock 适配器返回 db 内对象引用，这里必须复制后再合并，避免改坏种子数据。
 * @param {Object} order 接口返回的订单
 * @returns {Object} 合并后的订单
 */
function applyOrderOverride(order) {
  const patch = overrides.value.orders[String(order.id)]
  return patch ? { ...order, ...patch } : { ...order }
}

/** 金额格式化：保留 2 位小数并加千分位 */
function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/** 商品摘要：番茄 ×12、黄瓜 ×6 */
function itemsSummary(order) {
  const items = order?.items || []
  if (items.length === 0) {
    return '-'
  }
  return items.map((item) => `${item.goodsName} ×${item.quantity}`).join('、')
}

/** 订单总数量：各商品行数量之和 */
function quantityOf(order) {
  return (order?.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
}

/** 客户下拉选项 */
const customerOptions = computed(() =>
  customers.value.map((customer) => ({ label: customer.name, value: customer.id }))
)

/** 商品下拉选项：带上规格，便于区分同名不同规格 */
const goodsOptions = computed(() =>
  goods.value.map((item) => ({
    label: `${item.name}（${item.spec}）`,
    value: item.id
  }))
)

/** 查询字段：关键词 / 状态 / 下单日期 / 客户 */
const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '订单号 / 客户 / 商品',
    width: 220
  },
  { prop: 'status', label: '订单状态', type: 'select', options: ORDER_STATUS_OPTIONS, width: 150 },
  { prop: 'dateRange', label: '下单日期', type: 'daterange' },
  { prop: 'customerId', label: '客户', type: 'select', options: customerOptions.value, width: 210 }
])

/** 前端过滤：商品名参与关键词匹配（接口 keyword 不覆盖商品名） */
const filteredOrders = computed(() => {
  const query = orderQuery.value || {}
  const text = String(query.keyword || '')
    .trim()
    .toLowerCase()
  const range = Array.isArray(query.dateRange) ? query.dateRange : []
  return orders.value.filter((order) => {
    const itemNames = (order.items || []).map((item) => item.goodsName).join(' ')
    const matchKeyword =
      !text ||
      [order.orderNo, order.customerName, order.contact, order.phone, itemNames].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(text)
      )
    const matchStatus = !query.status || order.status === query.status
    const matchCustomer = !query.customerId || String(order.customerId) === String(query.customerId)
    const matchDate =
      range.length !== 2 ||
      (String(order.createdAt) >= range[0] && String(order.createdAt) <= range[1])
    return matchKeyword && matchStatus && matchCustomer && matchDate
  })
})

/** 当前页数据 */
const pagedOrders = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredOrders.value.slice(start, start + size.value)
})

/** 指标卡口径：本月订单数 / 待发货 / 本月销售额（不含取消）/ 退款取消数 */
const stats = computed(() => {
  const monthOrders = orders.value.filter((order) =>
    String(order.createdAt).startsWith(BUSINESS_MONTH)
  )
  return {
    monthCount: monthOrders.length,
    pendingShip: orders.value.filter((order) => order.status === 'PAID').length,
    monthSales: monthOrders
      .filter((order) => order.status !== 'CANCELLED')
      .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
    cancelled: orders.value.filter((order) => order.status === 'CANCELLED').length
  }
})

const statCards = computed(() => [
  {
    label: '本月订单数',
    value: stats.value.monthCount,
    unit: '笔',
    icon: 'Tickets',
    tone: 'brand'
  },
  { label: '待发货', value: stats.value.pendingShip, unit: '笔', icon: 'Van', tone: 'warn' },
  {
    label: '本月销售额',
    value: formatMoney(stats.value.monthSales),
    unit: '元',
    icon: 'Money',
    tone: 'ok'
  },
  {
    label: '退款/取消数',
    value: stats.value.cancelled,
    unit: '笔',
    icon: 'CircleClose',
    tone: 'danger'
  }
])

// 表格列：总宽 1060px，控制在窄屏可读范围内
const columns = [
  { prop: 'orderNo', label: '订单号', width: 150 },
  { prop: 'customerName', label: '客户', width: 150, showOverflowTooltip: true },
  { prop: 'items', label: '商品摘要', width: 150, slot: 'items', showOverflowTooltip: true },
  { prop: 'quantity', label: '数量', width: 80, slot: 'quantity', align: 'right' },
  { prop: 'totalAmount', label: '金额（元）', width: 120, slot: 'amount', align: 'right' },
  { prop: 'createdAt', label: '下单时间', width: 160 },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'action', label: '操作', width: 160, slot: 'action', align: 'center' }
]

const emptyText = computed(() => {
  const query = orderQuery.value || {}
  const hasFilter = Boolean(
    query.keyword || query.status || query.customerId || (query.dateRange || []).length
  )
  return hasFilter ? '暂无匹配订单，试试调整筛选条件' : '暂无订单，点击右上角「新建订单」创建'
})

/**
 * 是否允许取消：仅待付款 / 待发货可取消。
 * @param {Object} row 订单行
 * @returns {boolean} 是否可取消
 */
function canCancel(row) {
  return row.status === 'PENDING' || row.status === 'PAID'
}

/**
 * 是否允许发货：仅待发货可发货。
 * @param {Object} row 订单行
 * @returns {boolean} 是否可发货
 */
function canShip(row) {
  return row.status === 'PAID'
}

/** 载入订单、客户与商品：订单拉全量，客户/商品供筛选与表单选项 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [orderData, customerData, goodsData] = await Promise.all([
      fetchOrders({ page: 1, size: 100 }),
      fetchCustomers({ page: 1, size: 100 }),
      fetchGoods({ page: 1, size: 100 })
    ])
    orders.value = (orderData?.list || []).map(applyOrderOverride)
    customers.value = customerData?.list || []
    goods.value = goodsData?.list || []
    // 删除/取消后当前页可能越界，回退到最后一页
    const maxPage = Math.max(1, Math.ceil(filteredOrders.value.length / size.value))
    if (page.value > maxPage) {
      page.value = maxPage
    }
  } catch (err) {
    // 40401 静默进空态，其余错误给可重试入口
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/** 分页变化 */
function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

/** 查询 / 回车后回到第 1 页 */
function handleSearch() {
  page.value = 1
}

/** 重置后回到第 1 页 */
function handleReset() {
  page.value = 1
}

/** 打开新建订单弹窗 */
function openCreate() {
  selectedGoods.value = null
  orderVisible.value = true
}

/** 新建订单字段：客户 / 商品 / 数量 / 收货地址 / 备注 */
const orderFields = computed(() => [
  {
    prop: 'customerId',
    label: '客户',
    type: 'select',
    required: true,
    options: customerOptions.value
  },
  {
    prop: 'goodsId',
    label: '商品',
    type: 'select',
    required: true,
    options: goodsOptions.value
  },
  {
    prop: 'quantity',
    label: '数量',
    type: 'number',
    required: true,
    tip: selectedGoods.value
      ? `单价 ${formatMoney(selectedGoods.value.price)} 元/${selectedGoods.value.unit}，库存 ${selectedGoods.value.stock}${selectedGoods.value.unit}，数量不能超过库存`
      : '选择商品后自动带出单价与库存'
  },
  {
    prop: 'address',
    label: '收货地址',
    type: 'input',
    required: true,
    span: 2,
    placeholder: '选择客户后自动带出档案地址，可修改'
  },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2, placeholder: '如 要求冷链配送' }
])

const orderDefaults = { customerId: '', goodsId: '', quantity: 1, address: '', remark: '' }

const orderRules = {
  quantity: [{ required: true, message: '请输入订购数量', trigger: 'blur' }],
  address: [{ required: true, message: '请输入收货地址', trigger: 'blur' }]
}

/**
 * 弹窗字段联动：选商品带出单价库存，选客户带出档案地址。
 * AgriFormDialog 内部表单通过暴露的 setField 写入。
 * @param {Object} payload { prop, value }
 */
function handleOrderFieldChange({ prop, value }) {
  if (prop === 'goodsId') {
    selectedGoods.value = goods.value.find((item) => item.id === value) || null
    orderDialogRef.value?.setField('quantity', 1)
    return
  }
  if (prop === 'customerId') {
    const customer = customers.value.find((item) => item.id === value)
    if (customer) {
      orderDialogRef.value?.setField('address', customer.address || '')
    }
  }
}

/**
 * 提交新建订单：先做库存与数量校验，成功后回源刷新（不本地叠加）。
 * @param {Object} payload 表单值
 */
async function submitOrder(payload) {
  if (orderSubmitting.value) {
    return
  }
  const item = selectedGoods.value
  const quantity = Number(payload.quantity)
  if (!payload.customerId) {
    ElMessage.warning('请选择客户')
    return
  }
  if (!item) {
    ElMessage.warning('请选择商品')
    return
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    ElMessage.warning('订购数量必须大于 0')
    return
  }
  if (quantity > Number(item.stock || 0)) {
    ElMessage.error(`库存不足，${item.name} 当前仅剩 ${item.stock}${item.unit}`)
    return
  }
  if (!String(payload.address || '').trim()) {
    ElMessage.warning('请填写收货地址')
    return
  }
  orderSubmitting.value = true
  try {
    await createOrder({
      customerId: payload.customerId,
      items: [{ goodsId: item.id, quantity }],
      address: String(payload.address).trim(),
      remark: String(payload.remark || '').trim()
    })
    orderVisible.value = false
    page.value = 1
    ElMessage.success(`订单已创建：${item.name} ×${quantity}，状态为待付款`)
    await loadAll()
  } catch (err) {
    // 40001 / 40401 / 40901 已由请求层提示，这里只兜底资源不存在
    if (err?.code === 40401) {
      ElMessage.error('客户或商品已不存在，请刷新后重试')
    }
  } finally {
    orderSubmitting.value = false
  }
}

/**
 * 发货：确认弹窗输入物流单号（8–20 位字母或数字），成功后回源刷新。
 * @param {Object} row 订单行
 */
async function handleShip(row) {
  if (!canShip(row)) {
    ElMessage.warning('只有「待发货」订单可以发货')
    return
  }
  let logisticsNo = ''
  try {
    const result = await ElMessageBox.prompt(
      `订单 ${row.orderNo}（${row.customerName}）确认发货，请输入物流单号。`,
      '订单发货',
      {
        confirmButtonText: '确认发货',
        cancelButtonText: '取消',
        inputPattern: /^[A-Za-z0-9]{8,20}$/,
        inputErrorMessage: '物流单号需为 8–20 位字母或数字',
        inputPlaceholder: '如 SF1234567890'
      }
    )
    logisticsNo = String(result.value || '').trim()
  } catch (error) {
    // 用户取消 / 关闭弹窗，不做任何提示
    if (error === 'cancel' || error === 'close') {
      return
    }
    throw error
  }

  try {
    await shipOrder(row.id, { logisticsNo })
    ElMessage.success(`订单 ${row.orderNo} 已发货，物流单号 ${logisticsNo}`)
    await loadAll()
  } catch (err) {
    // 40901 / 40401 已由请求层提示，仅补一层资源失效说明
    if (err?.code === 40401) {
      ElMessage.error('订单已不存在，请刷新后重试')
    }
  }
}

/**
 * 取消订单：二次确认后写入本地覆盖（A23 无取消接口，见文件头说明）。
 * @param {Object} row 订单行
 */
async function handleCancel(row) {
  if (!canCancel(row)) {
    ElMessage.warning('仅「待付款」「待发货」订单可以取消')
    return
  }
  try {
    await ElMessageBox.confirm(`取消后订单 ${row.orderNo} 不可恢复，确认取消该订单？`, '取消订单', {
      type: 'warning',
      confirmButtonText: '确认取消',
      cancelButtonText: '再想想'
    })
  } catch {
    return
  }

  saveOrderOverride(row.id, {
    status: 'CANCELLED',
    statusName: ORDER_STATUS_MAP.CANCELLED.text,
    cancelledAt: BUSINESS_NOW_TEXT
  })
  ElMessage.success(`订单 ${row.orderNo} 已取消`)
  await loadAll()
}

/** 打开详情抽屉 */
function openDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

/**
 * 状态时间线：下单 → 付款 → 发货 → 完成，未到达的节点置灰。
 * 取消订单保留 4 个节点，未推进的节点不亮。
 */
const timelineNodes = computed(() => {
  const order = detailRow.value
  if (!order) {
    return []
  }
  return [
    { key: 'created', title: '下单', time: order.createdAt, active: true },
    { key: 'paid', title: '付款', time: order.paidAt, active: Boolean(order.paidAt) },
    { key: 'shipped', title: '发货', time: order.shippedAt, active: Boolean(order.shippedAt) },
    {
      key: 'done',
      title: '完成',
      time: order.status === 'DONE' ? order.shippedAt : '',
      active: order.status === 'DONE'
    }
  ]
})

const detailQuantity = computed(() => quantityOf(detailRow.value))

/** CSV 单元格转义 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** 导出当前筛选结果 CSV（带 BOM，Excel 直接打开不乱码） */
function exportCsv() {
  if (filteredOrders.value.length === 0) {
    ElMessage.warning('当前筛选结果为空，没有可导出的订单')
    return
  }
  const header = [
    '订单号',
    '客户',
    '联系人',
    '联系电话',
    '商品摘要',
    '数量',
    '金额(元)',
    '下单时间',
    '状态',
    '物流单号'
  ]
  const rows = filteredOrders.value.map((order) => [
    order.orderNo,
    order.customerName,
    order.contact,
    order.phone,
    itemsSummary(order),
    quantityOf(order),
    Number(order.totalAmount || 0).toFixed(2),
    order.createdAt,
    ORDER_STATUS_MAP[order.status]?.text || order.statusName || order.status,
    order.logisticsNo || ''
  ])
  const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `订单列表_20261116.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 笔订单`)
}

onMounted(() => {
  loadOverrides()
  loadAll()
})
</script>

<template>
  <div class="page-container commerce-orders">
    <AgriPageHeader
      page-id="P027"
      title="订单管理"
      description="跟踪销售订单的付款、发货与售后状态，支持新建订单、发货登记与明细导出。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button @click="exportCsv">导出 CSV</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="commerce-orders__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
          :loading="loading"
        />
      </el-col>
    </el-row>

    <div class="agri-card commerce-orders__section">
      <AgriSearchBar
        v-model="orderQuery"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card commerce-orders__section">
      <div v-if="loadError" class="commerce-orders__error" @click="loadAll">
        订单加载失败，点击重试
      </div>
      <AgriTable
        v-else
        :columns="columns"
        :data="pagedOrders"
        :loading="loading"
        :total="filteredOrders.length"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #toolbar>
          <div class="commerce-orders__toolbar">
            <div>
              <h3 class="commerce-orders__title">订单列表</h3>
              <span class="text-secondary commerce-orders__sub">
                共 {{ filteredOrders.length }} 笔，待发货 {{ stats.pendingShip }} 笔，退款/取消
                {{ stats.cancelled }} 笔
              </span>
            </div>
            <el-button type="primary" @click="openCreate">新建订单</el-button>
          </div>
        </template>

        <template #items="{ row }">{{ itemsSummary(row) }}</template>
        <template #quantity="{ row }">{{ quantityOf(row) }}</template>
        <template #amount="{ row }">{{ formatMoney(row.totalAmount) }}</template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="ORDER_STATUS_MAP" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
          <el-button link type="primary" :disabled="!canShip(row)" @click.stop="handleShip(row)">
            发货
          </el-button>
          <el-button link type="danger" :disabled="!canCancel(row)" @click.stop="handleCancel(row)">
            取消
          </el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 新建订单：客户、商品、数量、收货地址、备注 -->
    <AgriFormDialog
      ref="orderDialogRef"
      v-model="orderVisible"
      title="新建订单"
      :fields="orderFields"
      :rules="orderRules"
      :default-values="orderDefaults"
      :loading="orderSubmitting"
      width="640px"
      submit-text="提交订单"
      @field-change="handleOrderFieldChange"
      @submit="submitOrder"
    />

    <!-- 订单详情：基本信息 + 商品行 + 状态时间线 -->
    <el-drawer v-model="detailVisible" title="订单详情" size="620px">
      <div v-if="detailRow" class="commerce-orders__drawer">
        <div class="commerce-orders__drawer-head">
          <div>
            <h3 class="commerce-orders__title">{{ detailRow.orderNo }}</h3>
            <p class="text-secondary commerce-orders__sub">
              {{ detailRow.customerName }} · 共 {{ detailQuantity }} 件 ·
              {{ formatMoney(detailRow.totalAmount) }} 元
            </p>
          </div>
          <AgriStatusTag :status="detailRow.status" :map="ORDER_STATUS_MAP" />
        </div>

        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="客户">{{ detailRow.customerName }}</el-descriptions-item>
          <el-descriptions-item label="联系人">
            {{ detailRow.contact }} / {{ detailRow.phone }}
          </el-descriptions-item>
          <el-descriptions-item label="下单时间">{{ detailRow.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="支付方式">
            {{ PAY_METHOD_MAP[detailRow.payMethod] || detailRow.payMethod || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="收货地址" :span="2">
            {{ detailRow.address || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="物流单号">
            {{ detailRow.logisticsNo || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="订单金额">
            {{ formatMoney(detailRow.totalAmount) }} 元
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ detailRow.remark || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="commerce-orders__block-title">商品明细</h4>
        <el-table :data="detailRow.items || []" size="small" border>
          <el-table-column prop="goodsName" label="商品" min-width="110" />
          <el-table-column prop="spec" label="规格" width="100" />
          <el-table-column prop="unitPrice" label="单价(元)" width="90" align="right" />
          <el-table-column prop="quantity" label="数量" width="70" align="right" />
          <el-table-column prop="amount" label="金额(元)" width="100" align="right">
            <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
          </el-table-column>
        </el-table>

        <h4 class="commerce-orders__block-title">状态时间线</h4>
        <el-timeline class="commerce-orders__timeline">
          <el-timeline-item
            v-for="node in timelineNodes"
            :key="node.key"
            :color="node.active ? '#67c23a' : '#c0c4cc'"
            :hollow="!node.active"
            :timestamp="node.time || (node.active ? '已记录' : '未到达')"
          >
            <span :class="{ 'commerce-orders__node--idle': !node.active }">{{ node.title }}</span>
          </el-timeline-item>
        </el-timeline>
        <p v-if="detailRow.status === 'CANCELLED'" class="commerce-orders__tip text-secondary">
          该订单已取消，未推进的状态节点不再流转。
        </p>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.commerce-orders__stats {
  margin-bottom: $space-md;
}

.commerce-orders__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.commerce-orders__section {
  margin-bottom: $space-md;
}

.commerce-orders__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  width: 100%;
}

.commerce-orders__title {
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.commerce-orders__sub {
  font-size: $font-size-xs;
}

.commerce-orders__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.commerce-orders__drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-md;
}

.commerce-orders__block-title {
  margin: $space-md 0 $space-sm;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.commerce-orders__timeline {
  padding-left: $space-xs;
}

.commerce-orders__node--idle {
  color: $text-secondary;
}

.commerce-orders__tip {
  font-size: $font-size-xs;
}

@media (max-width: $breakpoint-sm) {
  .commerce-orders__toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
