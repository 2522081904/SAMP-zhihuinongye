<script setup>
/**
 * P028 商品与客户档案
 * 数据来源：A24 商品与客户（GET /trade/goods、POST /trade/goods、GET /trade/customers、
 *           POST /trade/customers）、A23 销售订单（GET /trade/orders?customerId= 供客户最近订单）。
 * 数据缺口与落地口径：
 * - A24 只有「新增商品」「新增客户」，没有更新商品、上下架、停用客户接口：
 *   编辑商品、上下架、停用客户的结果记在 sessionStorage（agri-commerce-overrides-v1），
 *   仅本机可见、刷新不丢；新增走真实接口，成功后统一回源刷新，不在本地叠加；
 * - A24 商品无「描述」字段、客户无「类型 / 备注」字段：类型先按客户名称关键字推断种子数据，
 *   新建客户时把所选类型与备注写入本地覆盖，商品描述同样只落在本地覆盖（详见各方法注释）；
 * - A24 客户列表的 keyword 覆盖编号 / 名称 / 联系人 / 电话，前端再做一次过滤以防口径变化；
 * - 客户等级沿用 A24 的 level（VIP / NORMAL），与「客户类型」是两回事，页面只展示类型。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，「本月新增」按 2026-11 判定。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { createCustomer, createGoods, fetchCustomers, fetchGoods, fetchOrders } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'CommerceProductListPage' })

// 业务时间：mock 世界固定「现在」，「本月」按 2026-11 口径
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)

// 本地覆盖存储：A24 缺失的编辑 / 上下架 / 停用结果暂存在这里（见文件头说明）
const OVERRIDE_KEY = 'agri-commerce-overrides-v1'

// 商品状态：在售 / 下架（A24 的 OFF_SHELF 文案是「已下架」，这里统一成「下架」）
const GOODS_STATUS_MAP = {
  ON_SALE: { text: '在售', type: 'success' },
  OFF_SHELF: { text: '下架', type: 'info' }
}

// 商品类别：代码与 A24 categoryName 保持一致
const GOODS_CATEGORY_OPTIONS = [
  { label: '蔬菜', value: 'VEGETABLE' },
  { label: '水果', value: 'FRUIT' },
  { label: '粮油', value: 'GRAIN' },
  { label: '中药材', value: 'MEDICINE' }
]

const GOODS_CATEGORY_NAMES = GOODS_CATEGORY_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label
  return acc
}, {})

// 客户状态：启用 / 停用（A24 只有 ENABLED）
const CUSTOMER_STATUS_MAP = {
  ENABLED: { text: '启用', type: 'success' },
  DISABLED: { text: '已停用', type: 'info' }
}

// 客户类型：A24 没有该字段，种子按名称推断，新建时由表单写入本地覆盖
const CUSTOMER_TYPE_OPTIONS = [
  { label: '批发商', value: 'WHOLESALE' },
  { label: '商超', value: 'MARKET' },
  { label: '餐饮', value: 'CATERING' },
  { label: '个人', value: 'PERSONAL' }
]

const CUSTOMER_TYPE_MAP = {
  WHOLESALE: { text: '批发商', type: 'primary' },
  MARKET: { text: '商超', type: 'success' },
  CATERING: { text: '餐饮', type: 'warning' },
  PERSONAL: { text: '个人', type: 'info' }
}

// 订单状态：客户详情里展示最近订单要用
const ORDER_STATUS_MAP = {
  PENDING: { text: '待付款', type: 'warning' },
  PAID: { text: '待发货', type: 'primary' },
  SHIPPED: { text: '已发货', type: 'info' },
  DONE: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' }
}

// 当前 Tab：goods / customers
const activeTab = ref('goods')

// 商品档案数据与三态
const goodsList = ref([])
const goodsLoading = ref(false)
const goodsLoadError = ref(false)
const goodsPage = ref(1)
const goodsSize = ref(10)
const goodsQuery = ref({ keyword: '', category: '', status: '' })

// 客户档案数据与三态
const customerList = ref([])
const customerLoading = ref(false)
const customerLoadError = ref(false)
const customerPage = ref(1)
const customerSize = ref(10)
const customerQuery = ref({ keyword: '', type: '' })

// 本地覆盖（商品编辑 / 上下架、客户停用 / 类型 / 备注）
const overrides = ref({ goods: {}, customers: {} })

// 商品弹窗：新增与编辑共用一个 AgriFormDialog
const goodsDialogVisible = ref(false)
const goodsDialogMode = ref('create')
const goodsSubmitting = ref(false)
const goodsEditData = ref({})
// 编辑中的商品 id：表格行数据只在弹窗打开时回填，提交时靠它定位本地覆盖
const goodsEditingId = ref(null)

// 客户弹窗
const customerDialogVisible = ref(false)
const customerSubmitting = ref(false)

// 商品详情抽屉
const goodsDetailVisible = ref(false)
const goodsDetailRow = ref(null)

// 客户详情抽屉
const customerDetailVisible = ref(false)
const customerDetailRow = ref(null)
const customerOrders = ref([])
const customerOrdersLoading = ref(false)

/**
 * 读取本地覆盖（解析失败时退回空结构，避免脏数据让页面白屏）。
 */
function loadOverrides() {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    overrides.value = {
      goods: parsed?.goods || {},
      customers: parsed?.customers || {}
    }
  } catch {
    overrides.value = { goods: {}, customers: {} }
  }
}

/**
 * 写回本地覆盖（隐私模式不可写时只保留内存态）。
 * 注意：P027 的订单取消共用同一个 key，因此这里必须按字段合并，不能整体覆盖。
 */
function persistOverrides() {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    sessionStorage.setItem(
      OVERRIDE_KEY,
      JSON.stringify({
        ...parsed,
        goods: overrides.value.goods,
        customers: overrides.value.customers
      })
    )
  } catch {
    // 忽略写入失败，页面仍以内存态展示
  }
}

/**
 * 保存商品覆盖字段。
 * @param {number|string} id 商品 id
 * @param {Object} patch 覆盖字段
 */
function saveGoodsOverride(id, patch) {
  const key = String(id)
  overrides.value.goods[key] = { ...overrides.value.goods[key], ...patch }
  persistOverrides()
}

/**
 * 保存客户覆盖字段。
 * @param {number|string} id 客户 id
 * @param {Object} patch 覆盖字段
 */
function saveCustomerOverride(id, patch) {
  const key = String(id)
  overrides.value.customers[key] = { ...overrides.value.customers[key], ...patch }
  persistOverrides()
}

/**
 * 把商品覆盖合并进接口返回的行。
 * mock 适配器返回 db 内对象引用，这里必须复制后再合并，避免改坏种子数据。
 * @param {Object} goods 接口返回的商品
 * @returns {Object} 合并后的商品
 */
function applyGoodsOverride(goods) {
  const patch = overrides.value.goods[String(goods.id)]
  return patch ? { ...goods, ...patch } : { ...goods }
}

/**
 * 按名称推断客户类型（A24 无类型字段，种子数据只能靠名称特征归类）。
 * @param {Object} customer 客户
 * @returns {string} 类型代码
 */
function inferCustomerType(customer) {
  if (customer.customerType) {
    return customer.customerType
  }
  const name = String(customer.name || '')
  if (/餐饮|饭店|酒楼|食堂|后勤|酒店/.test(name)) {
    return 'CATERING'
  }
  if (/超市|鲜生|买菜|便利|商超/.test(name)) {
    return 'MARKET'
  }
  if (/批发|商贸|物流|贸易|果蔬店|经销|供应链/.test(name)) {
    return 'WHOLESALE'
  }
  return 'PERSONAL'
}

/**
 * 把客户覆盖合并进接口返回的行，并补上推断出的类型。
 * @param {Object} customer 接口返回的客户
 * @returns {Object} 合并后的客户
 */
function applyCustomerOverride(customer) {
  const patch = overrides.value.customers[String(customer.id)]
  const merged = patch ? { ...customer, ...patch } : { ...customer }
  return { ...merged, customerType: inferCustomerType(merged) }
}

/** 金额格式化：保留 2 位小数并加千分位 */
function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * 手机号打码：13805170021 → 138****0021。
 * 非 11 位号码原样返回，避免误伤固话。
 * @param {string} phone 手机号
 * @returns {string} 打码后的号码
 */
function maskPhone(phone) {
  const text = String(phone || '')
  return text.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
}

/** 商品类别展示名：优先 categoryName，兜底本地字典 */
function categoryText(row) {
  return row.categoryName || GOODS_CATEGORY_NAMES[row.category] || '-'
}

/** 客户类型展示名 */
function customerTypeText(row) {
  return CUSTOMER_TYPE_MAP[row.customerType]?.text || '-'
}

/** 商品筛选：关键词覆盖编码 / 名称 / 规格 / 类别名 */
const filteredGoods = computed(() => {
  const text = String(goodsQuery.value.keyword || '')
    .trim()
    .toLowerCase()
  return goodsList.value.filter((goods) => {
    const matchKeyword =
      !text ||
      [goods.code, goods.name, goods.spec, categoryText(goods)].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(text)
      )
    const matchCategory = !goodsQuery.value.category || goods.category === goodsQuery.value.category
    const matchStatus = !goodsQuery.value.status || goods.status === goodsQuery.value.status
    return matchKeyword && matchCategory && matchStatus
  })
})

/** 客户筛选：关键词覆盖编号 / 名称 / 联系人 / 电话 / 类型名 */
const filteredCustomers = computed(() => {
  const text = String(customerQuery.value.keyword || '')
    .trim()
    .toLowerCase()
  return customerList.value.filter((customer) => {
    const matchKeyword =
      !text ||
      [
        customer.code,
        customer.name,
        customer.contact,
        customer.phone,
        customerTypeText(customer)
      ].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(text)
      )
    const matchType =
      !customerQuery.value.type || customer.customerType === customerQuery.value.type
    return matchKeyword && matchType
  })
})

/** 商品当前页 */
const pagedGoods = computed(() => {
  const start = (goodsPage.value - 1) * goodsSize.value
  return filteredGoods.value.slice(start, start + goodsSize.value)
})

/** 客户当前页 */
const pagedCustomers = computed(() => {
  const start = (customerPage.value - 1) * customerSize.value
  return filteredCustomers.value.slice(start, start + customerSize.value)
})

/** 商品指标卡：商品数 / 在售数 / 库存总量 */
const goodsStats = computed(() => ({
  total: goodsList.value.length,
  onSale: goodsList.value.filter((goods) => goods.status === 'ON_SALE').length,
  stock: goodsList.value.reduce((sum, goods) => sum + Number(goods.stock || 0), 0)
}))

/** 客户指标卡：客户数 / 本月新增 */
const customerStats = computed(() => ({
  total: customerList.value.length,
  monthNew: customerList.value.filter((customer) =>
    String(customer.createdAt).startsWith(BUSINESS_MONTH)
  ).length
}))

const goodsCards = computed(() => [
  { label: '商品数', value: goodsStats.value.total, unit: '个', icon: 'Goods', tone: 'brand' },
  {
    label: '在售数',
    value: goodsStats.value.onSale,
    unit: '个',
    icon: 'Sell',
    tone: 'ok'
  },
  {
    label: '库存总量',
    value: goodsStats.value.stock.toLocaleString('zh-CN'),
    unit: '件',
    icon: 'Box',
    tone: 'warn'
  }
])

const customerCards = computed(() => [
  {
    label: '客户数',
    value: customerStats.value.total,
    unit: '家',
    icon: 'User',
    tone: 'brand'
  },
  {
    label: '本月新增',
    value: customerStats.value.monthNew,
    unit: '家',
    icon: 'Plus',
    tone: 'ok'
  }
])

const goodsSearchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '编码 / 名称 / 规格',
    width: 220
  },
  { prop: 'category', label: '类别', type: 'select', options: GOODS_CATEGORY_OPTIONS, width: 140 },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    options: Object.entries(GOODS_STATUS_MAP).map(([value, item]) => ({
      value,
      label: item.text
    })),
    width: 130
  }
])

const customerSearchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '编号 / 名称 / 联系人 / 电话',
    width: 220
  },
  { prop: 'type', label: '类型', type: 'select', options: CUSTOMER_TYPE_OPTIONS, width: 140 }
])

// 商品表格列：总宽约 990px，控制在窄屏可读范围内
const goodsColumns = [
  { prop: 'code', label: '商品编码', width: 130 },
  { prop: 'name', label: '名称', width: 130, showOverflowTooltip: true },
  { prop: 'categoryName', label: '类别', width: 90, slot: 'category' },
  { prop: 'spec', label: '规格', width: 120 },
  { prop: 'unit', label: '单位', width: 70, align: 'center' },
  { prop: 'price', label: '单价（元）', width: 100, slot: 'price', align: 'right' },
  { prop: 'stock', label: '库存', width: 90, slot: 'stock', align: 'right' },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'action', label: '操作', width: 200, slot: 'action', align: 'center' }
]

// 客户表格列：总宽约 920px
const customerColumns = [
  { prop: 'code', label: '客户编号', width: 130 },
  { prop: 'name', label: '名称', width: 180, showOverflowTooltip: true },
  { prop: 'contact', label: '联系人', width: 90 },
  { prop: 'phone', label: '电话', width: 120, slot: 'phone' },
  { prop: 'customerType', label: '类型', width: 90, slot: 'type' },
  { prop: 'orderCount', label: '累计订单数', width: 110, align: 'right' },
  { prop: 'totalAmount', label: '累计金额（元）', width: 130, slot: 'amount', align: 'right' },
  { prop: 'action', label: '操作', width: 130, slot: 'action', align: 'center' }
]

const goodsEmptyText = computed(() => {
  const hasFilter = Boolean(
    goodsQuery.value.keyword || goodsQuery.value.category || goodsQuery.value.status
  )
  return hasFilter ? '暂无匹配商品，试试调整筛选条件' : '暂无商品档案，点击右上角「新增商品」建档'
})

const customerEmptyText = computed(() => {
  const hasFilter = Boolean(customerQuery.value.keyword || customerQuery.value.type)
  return hasFilter ? '暂无匹配客户，试试调整筛选条件' : '暂无客户档案，点击右上角「新增客户」建档'
})

/** 载入商品与客户：一次拉全量后前端筛选分页（与 P027 同口径） */
async function loadAll() {
  goodsLoading.value = true
  customerLoading.value = true
  goodsLoadError.value = false
  customerLoadError.value = false
  try {
    const [goodsData, customerData] = await Promise.all([
      fetchGoods({ page: 1, size: 100 }),
      fetchCustomers({ page: 1, size: 100 })
    ])
    goodsList.value = (goodsData?.list || []).map(applyGoodsOverride)
    customerList.value = (customerData?.list || []).map(applyCustomerOverride)
    // 新增/筛选后当前页可能越界，回退到最后一页
    const maxGoodsPage = Math.max(1, Math.ceil(filteredGoods.value.length / goodsSize.value))
    if (goodsPage.value > maxGoodsPage) {
      goodsPage.value = maxGoodsPage
    }
    const maxCustomerPage = Math.max(
      1,
      Math.ceil(filteredCustomers.value.length / customerSize.value)
    )
    if (customerPage.value > maxCustomerPage) {
      customerPage.value = maxCustomerPage
    }
  } catch (err) {
    // 40401 静默进空态，其余错误给可重试入口（请求层已提示）
    if (err?.code !== 40401) {
      goodsLoadError.value = true
      customerLoadError.value = true
    }
  } finally {
    goodsLoading.value = false
    customerLoading.value = false
  }
}

/** 商品分页变化 */
function handleGoodsPageChange(payload) {
  goodsPage.value = payload.page
  goodsSize.value = payload.size
}

/** 客户分页变化 */
function handleCustomerPageChange(payload) {
  customerPage.value = payload.page
  customerSize.value = payload.size
}

/** 商品查询 / 重置：都回到第 1 页 */
function handleGoodsSearch() {
  goodsPage.value = 1
}

/** 客户查询 / 重置：都回到第 1 页 */
function handleCustomerSearch() {
  customerPage.value = 1
}

// 商品弹窗字段：名称 / 类别 / 规格 / 单位 / 单价 / 库存 / 描述
const goodsFields = computed(() => [
  {
    prop: 'name',
    label: '商品名称',
    type: 'input',
    required: true,
    placeholder: '如 有机番茄'
  },
  {
    prop: 'category',
    label: '类别',
    type: 'select',
    required: true,
    options: GOODS_CATEGORY_OPTIONS
  },
  { prop: 'spec', label: '规格', type: 'input', required: true, placeholder: '如 5kg/箱' },
  { prop: 'unit', label: '单位', type: 'input', required: true, placeholder: '如 箱 / 袋 / 盒' },
  { prop: 'price', label: '单价（元）', type: 'number', required: true },
  { prop: 'stock', label: '库存', type: 'number', required: true },
  {
    prop: 'description',
    label: '描述',
    type: 'textarea',
    span: 2,
    placeholder: '如 产地、等级、包装与储运要求（A24 不落库，仅本地记录）'
  }
])

const goodsDefaults = {
  name: '',
  category: 'VEGETABLE',
  spec: '',
  unit: '箱',
  price: null,
  stock: null,
  description: ''
}

const goodsRules = {
  name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }],
  spec: [{ required: true, message: '请输入规格', trigger: 'blur' }],
  unit: [{ required: true, message: '请输入单位', trigger: 'blur' }],
  price: [{ required: true, message: '请输入销售单价', trigger: 'blur' }],
  stock: [{ required: true, message: '请输入库存数量', trigger: 'blur' }]
}

/** 打开新增商品弹窗 */
function openCreateGoods() {
  goodsDialogMode.value = 'create'
  goodsEditingId.value = null
  goodsEditData.value = {}
  goodsDialogVisible.value = true
}

/**
 * 打开编辑商品弹窗：把当前行（含本地覆盖）回填进去。
 * @param {Object} row 商品行
 */
function openEditGoods(row) {
  goodsDialogMode.value = 'edit'
  goodsEditingId.value = row.id
  goodsEditData.value = {
    name: row.name,
    category: row.category,
    spec: row.spec,
    unit: row.unit,
    price: row.price,
    stock: row.stock,
    description: row.description || ''
  }
  goodsDialogVisible.value = true
}

/**
 * 提交商品表单：新增走 A24，编辑写本地覆盖（A24 无更新接口）。
 * @param {Object} payload 表单值
 */
async function submitGoods(payload) {
  if (goodsSubmitting.value) {
    return
  }
  const name = String(payload.name || '').trim()
  const spec = String(payload.spec || '').trim()
  const unit = String(payload.unit || '').trim()
  const price = Number(payload.price)
  const stock = Number(payload.stock)
  if (!name || !spec || !unit) {
    ElMessage.warning('商品名称、规格与单位不能为空')
    return
  }
  if (!Number.isFinite(price) || price <= 0) {
    ElMessage.warning('销售单价必须大于 0')
    return
  }
  if (!Number.isInteger(stock) || stock < 0) {
    ElMessage.warning('库存必须为不小于 0 的整数')
    return
  }

  goodsSubmitting.value = true
  try {
    if (goodsDialogMode.value === 'edit') {
      const editingId = goodsEditingId.value
      if (!editingId) {
        ElMessage.error('商品信息已失效，请刷新后重试')
        return
      }
      saveGoodsOverride(editingId, {
        name,
        category: payload.category,
        categoryName: GOODS_CATEGORY_NAMES[payload.category] || '蔬菜',
        spec,
        unit,
        price,
        stock,
        description: String(payload.description || '')
      })
      goodsDialogVisible.value = false
      ElMessage.success('商品信息已保存（A24 缺少更新接口，本次仅记录在本地）')
      await loadAll()
      return
    }

    const created = await createGoods({
      name,
      category: payload.category,
      categoryName: GOODS_CATEGORY_NAMES[payload.category] || '蔬菜',
      spec,
      unit,
      price,
      stock
    })
    // 描述字段 A24 不接收，落到本地覆盖，保证详情抽屉能看到
    if (created?.id && String(payload.description || '').trim()) {
      saveGoodsOverride(created.id, { description: String(payload.description).trim() })
    }
    goodsDialogVisible.value = false
    goodsPage.value = 1
    ElMessage.success(`商品「${name}」已建档，初始状态为在售`)
    await loadAll()
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('商品已不存在，请刷新后重试')
    }
  } finally {
    goodsSubmitting.value = false
  }
}

/**
 * 上下架切换：A24 没有上下架接口，写本地覆盖后回源刷新。
 * @param {Object} row 商品行
 */
async function toggleGoodsStatus(row) {
  const nextStatus = row.status === 'ON_SALE' ? 'OFF_SHELF' : 'ON_SALE'
  saveGoodsOverride(row.id, {
    status: nextStatus,
    statusName: nextStatus === 'ON_SALE' ? '在售' : '已下架'
  })
  ElMessage.success(
    `「${row.name}」已${nextStatus === 'ON_SALE' ? '上架' : '下架'}（A24 缺少上下架接口，本次仅记录在本地）`
  )
  await loadAll()
}

/** 打开商品详情抽屉 */
function openGoodsDetail(row) {
  goodsDetailRow.value = row
  goodsDetailVisible.value = true
}

/** 打开新增客户弹窗 */
function openCreateCustomer() {
  customerDialogVisible.value = true
}

// 客户弹窗字段：名称 / 联系人 / 电话 / 类型 / 地址 / 备注
const customerFields = computed(() => [
  { prop: 'name', label: '客户名称', type: 'input', required: true, span: 2 },
  { prop: 'contact', label: '联系人', type: 'input', required: true },
  { prop: 'phone', label: '联系电话', type: 'input', required: true, placeholder: '11 位手机号' },
  {
    prop: 'customerType',
    label: '客户类型',
    type: 'select',
    required: true,
    options: CUSTOMER_TYPE_OPTIONS
  },
  { prop: 'address', label: '地址', type: 'input', span: 2 },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
])

const customerDefaults = {
  name: '',
  contact: '',
  phone: '',
  customerType: 'WHOLESALE',
  address: '',
  remark: ''
}

const customerRules = {
  name: [{ required: true, message: '请输入客户名称', trigger: 'blur' }],
  contact: [{ required: true, message: '请输入联系人', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入联系电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号', trigger: 'blur' }
  ]
}

/**
 * 提交新增客户：电话正则双保险（表单规则 + 提交前显式校验），
 * 成功后把类型与备注写入本地覆盖（A24 无这两个字段）。
 * @param {Object} payload 表单值
 */
async function submitCustomer(payload) {
  if (customerSubmitting.value) {
    return
  }
  const name = String(payload.name || '').trim()
  const contact = String(payload.contact || '').trim()
  const phone = String(payload.phone || '').trim()
  if (!name || !contact || !phone) {
    ElMessage.warning('客户名称、联系人与联系电话不能为空')
    return
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    ElMessage.warning('联系电话格式不正确，应为 1 开头的 11 位手机号')
    return
  }

  customerSubmitting.value = true
  try {
    const created = await createCustomer({
      name,
      contact,
      phone,
      address: String(payload.address || '').trim(),
      // 等级沿用 A24 口径：批发商 / 商超视为重点客户
      level: payload.customerType === 'PERSONAL' ? 'NORMAL' : 'VIP',
      levelName: payload.customerType === 'PERSONAL' ? '普通客户' : '重点客户'
    })
    if (created?.id) {
      saveCustomerOverride(created.id, {
        customerType: payload.customerType,
        remark: String(payload.remark || '').trim(),
        status: 'ENABLED',
        statusName: '启用'
      })
    }
    customerDialogVisible.value = false
    customerPage.value = 1
    ElMessage.success(`客户「${name}」已建档`)
    await loadAll()
  } catch (err) {
    if (err?.code === 40901) {
      ElMessage.error(`客户「${name}」已存在，请勿重复建档`)
    }
  } finally {
    customerSubmitting.value = false
  }
}

/**
 * 停用客户：二次确认后写本地覆盖（A24 无停用接口）。
 * @param {Object} row 客户行
 */
async function disableCustomer(row) {
  if (row.status === 'DISABLED') {
    ElMessage.info(`客户「${row.name}」已停用`)
    return
  }
  try {
    await ElMessageBox.confirm(
      `停用后客户「${row.name}」将不再参与新建订单选择，确认停用？`,
      '停用客户',
      { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  saveCustomerOverride(row.id, { status: 'DISABLED', statusName: '已停用' })
  ElMessage.success(`客户「${row.name}」已停用（A24 缺少停用接口，本次仅记录在本地）`)
  await loadAll()
}

/**
 * 打开客户详情抽屉：基本信息 + 最近 5 笔订单（A23 按 customerId 过滤）。
 * @param {Object} row 客户行
 */
async function openCustomerDetail(row) {
  customerDetailRow.value = row
  customerDetailVisible.value = true
  customerOrders.value = []
  customerOrdersLoading.value = true
  try {
    const data = await fetchOrders({ customerId: row.id, page: 1, size: 5 })
    customerOrders.value = data?.list || []
  } catch {
    // 40401 视为无订单，静默入空态
    customerOrders.value = []
  } finally {
    customerOrdersLoading.value = false
  }
}

/** 客户最近订单的商品摘要 */
function orderItemsSummary(order) {
  const items = order?.items || []
  if (items.length === 0) {
    return '-'
  }
  return items.map((item) => `${item.goodsName} ×${item.quantity}`).join('、')
}

/** CSV 单元格转义 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 导出 CSV（带 BOM，Excel 直接打开不乱码）。
 * @param {string} type goods / customers
 */
function exportCsv(type) {
  const isGoods = type === 'goods'
  const list = isGoods ? filteredGoods.value : filteredCustomers.value
  if (list.length === 0) {
    ElMessage.warning('当前筛选结果为空，没有可导出的数据')
    return
  }
  const header = isGoods
    ? [
        '商品编码',
        '名称',
        '类别',
        '规格',
        '单位',
        '单价(元)',
        '库存',
        '状态',
        '累计销量',
        '建档时间'
      ]
    : [
        '客户编号',
        '名称',
        '联系人',
        '电话',
        '类型',
        '累计订单数',
        '累计金额(元)',
        '状态',
        '建档时间'
      ]
  const rows = list.map((row) =>
    isGoods
      ? [
          row.code,
          row.name,
          categoryText(row),
          row.spec,
          row.unit,
          Number(row.price || 0).toFixed(2),
          row.stock,
          GOODS_STATUS_MAP[row.status]?.text || row.status,
          row.salesCount || 0,
          row.createdAt
        ]
      : [
          row.code,
          row.name,
          row.contact,
          row.phone,
          customerTypeText(row),
          row.orderCount || 0,
          Number(row.totalAmount || 0).toFixed(2),
          CUSTOMER_STATUS_MAP[row.status]?.text || row.status,
          row.createdAt
        ]
  )
  const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = isGoods ? '商品档案_20261116.csv' : '客户档案_20261116.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条${isGoods ? '商品' : '客户'}档案`)
}

onMounted(() => {
  loadOverrides()
  loadAll()
})
</script>

<template>
  <div class="page-container commerce-products">
    <AgriPageHeader
      page-id="P028"
      title="商品与客户档案"
      description="维护上架商品信息与采购客户档案，商品档案支撑订单选购，客户档案支撑产销对接。"
    >
      <template #extra>
        <el-button :loading="goodsLoading || customerLoading" @click="loadAll">刷新</el-button>
      </template>
    </AgriPageHeader>

    <el-tabs v-model="activeTab" class="commerce-products__tabs">
      <!-- 商品档案 -->
      <el-tab-pane label="商品档案" name="goods">
        <el-row :gutter="16" class="commerce-products__stats">
          <el-col v-for="card in goodsCards" :key="card.label" :xs="12" :sm="8" :md="8">
            <AgriStatCard
              :label="card.label"
              :value="card.value"
              :unit="card.unit"
              :icon="card.icon"
              :tone="card.tone"
              :loading="goodsLoading"
            />
          </el-col>
        </el-row>

        <div class="agri-card commerce-products__section">
          <AgriSearchBar
            v-model="goodsQuery"
            :fields="goodsSearchFields"
            :loading="goodsLoading"
            @search="handleGoodsSearch"
            @reset="handleGoodsSearch"
          />
        </div>

        <div class="agri-card commerce-products__section">
          <div v-if="goodsLoadError" class="commerce-products__error" @click="loadAll">
            商品档案加载失败，点击重试
          </div>
          <AgriTable
            v-else
            :columns="goodsColumns"
            :data="pagedGoods"
            :loading="goodsLoading"
            :total="filteredGoods.length"
            :page="goodsPage"
            :size="goodsSize"
            row-key="id"
            :empty-text="goodsEmptyText"
            @page-change="handleGoodsPageChange"
            @size-change="handleGoodsPageChange"
          >
            <template #toolbar>
              <div class="commerce-products__toolbar">
                <div>
                  <h3 class="commerce-products__title">商品档案</h3>
                  <span class="text-secondary commerce-products__sub">
                    共 {{ filteredGoods.length }} 个，在售 {{ goodsStats.onSale }} 个，库存合计
                    {{ goodsStats.stock }} 件
                  </span>
                </div>
                <div class="commerce-products__actions">
                  <el-button @click="exportCsv('goods')">导出 CSV</el-button>
                  <el-button type="primary" @click="openCreateGoods">新增商品</el-button>
                </div>
              </div>
            </template>

            <template #category="{ row }">{{ categoryText(row) }}</template>
            <template #price="{ row }">{{ formatMoney(row.price) }}</template>
            <template #stock="{ row }">{{ row.stock }}</template>
            <template #status="{ row }">
              <AgriStatusTag :status="row.status" :map="GOODS_STATUS_MAP" />
            </template>
            <template #action="{ row }">
              <el-button link type="primary" @click.stop="openEditGoods(row)">编辑</el-button>
              <el-switch
                class="commerce-products__switch"
                :model-value="row.status === 'ON_SALE'"
                :title="row.status === 'ON_SALE' ? '点击下架' : '点击上架'"
                @change="toggleGoodsStatus(row)"
              />
              <el-button link type="primary" @click.stop="openGoodsDetail(row)">详情</el-button>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>

      <!-- 客户档案 -->
      <el-tab-pane label="客户档案" name="customers">
        <el-row :gutter="16" class="commerce-products__stats">
          <el-col v-for="card in customerCards" :key="card.label" :xs="12" :sm="12" :md="12">
            <AgriStatCard
              :label="card.label"
              :value="card.value"
              :unit="card.unit"
              :icon="card.icon"
              :tone="card.tone"
              :loading="customerLoading"
            />
          </el-col>
        </el-row>

        <div class="agri-card commerce-products__section">
          <AgriSearchBar
            v-model="customerQuery"
            :fields="customerSearchFields"
            :loading="customerLoading"
            @search="handleCustomerSearch"
            @reset="handleCustomerSearch"
          />
        </div>

        <div class="agri-card commerce-products__section">
          <div v-if="customerLoadError" class="commerce-products__error" @click="loadAll">
            客户档案加载失败，点击重试
          </div>
          <AgriTable
            v-else
            :columns="customerColumns"
            :data="pagedCustomers"
            :loading="customerLoading"
            :total="filteredCustomers.length"
            :page="customerPage"
            :size="customerSize"
            row-key="id"
            :empty-text="customerEmptyText"
            @page-change="handleCustomerPageChange"
            @size-change="handleCustomerPageChange"
          >
            <template #toolbar>
              <div class="commerce-products__toolbar">
                <div>
                  <h3 class="commerce-products__title">客户档案</h3>
                  <span class="text-secondary commerce-products__sub">
                    共 {{ filteredCustomers.length }} 家，本月新增 {{ customerStats.monthNew }} 家
                  </span>
                </div>
                <div class="commerce-products__actions">
                  <el-button @click="exportCsv('customers')">导出 CSV</el-button>
                  <el-button type="primary" @click="openCreateCustomer">新增客户</el-button>
                </div>
              </div>
            </template>

            <template #phone="{ row }">{{ maskPhone(row.phone) }}</template>
            <template #type="{ row }">{{ customerTypeText(row) }}</template>
            <template #amount="{ row }">{{ formatMoney(row.totalAmount) }}</template>
            <template #action="{ row }">
              <el-button link type="primary" @click.stop="openCustomerDetail(row)">详情</el-button>
              <el-button
                link
                type="danger"
                :disabled="row.status === 'DISABLED'"
                @click.stop="disableCustomer(row)"
              >
                停用
              </el-button>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 商品新增 / 编辑：同一个弹窗，编辑时回填 -->
    <AgriFormDialog
      v-model="goodsDialogVisible"
      :title="goodsDialogMode === 'edit' ? '编辑商品' : '新增商品'"
      :fields="goodsFields"
      :rules="goodsRules"
      :default-values="goodsDefaults"
      :edit-data="goodsEditData"
      :loading="goodsSubmitting"
      width="640px"
      :submit-text="goodsDialogMode === 'edit' ? '保存' : '提交建档'"
      @submit="submitGoods"
    />

    <!-- 新增客户 -->
    <AgriFormDialog
      v-model="customerDialogVisible"
      title="新增客户"
      :fields="customerFields"
      :rules="customerRules"
      :default-values="customerDefaults"
      :loading="customerSubmitting"
      width="640px"
      submit-text="提交建档"
      @submit="submitCustomer"
    />

    <!-- 商品详情 -->
    <el-drawer v-model="goodsDetailVisible" title="商品详情" size="520px">
      <div v-if="goodsDetailRow" class="commerce-products__drawer">
        <div class="commerce-products__drawer-head">
          <div>
            <h3 class="commerce-products__title">{{ goodsDetailRow.name }}</h3>
            <p class="text-secondary commerce-products__sub">
              {{ goodsDetailRow.code }} · {{ categoryText(goodsDetailRow) }}
            </p>
          </div>
          <AgriStatusTag :status="goodsDetailRow.status" :map="GOODS_STATUS_MAP" />
        </div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="规格">{{ goodsDetailRow.spec }}</el-descriptions-item>
          <el-descriptions-item label="单位">{{ goodsDetailRow.unit }}</el-descriptions-item>
          <el-descriptions-item label="销售单价">
            {{ formatMoney(goodsDetailRow.price) }} 元
          </el-descriptions-item>
          <el-descriptions-item label="库存">{{ goodsDetailRow.stock }}</el-descriptions-item>
          <el-descriptions-item label="累计销量">
            {{ goodsDetailRow.salesCount || 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="建档时间">
            {{ goodsDetailRow.createdAt }}
          </el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">
            {{ goodsDetailRow.description || 'A24 商品档案暂无描述字段' }}
          </el-descriptions-item>
        </el-descriptions>
        <p class="commerce-products__tip text-secondary">
          库存与价格随订单流转变化；编辑与上下架结果仅记录在本机（A24 未提供对应接口）。
        </p>
      </div>
    </el-drawer>

    <!-- 客户详情：基本信息 + 最近 5 笔订单 -->
    <el-drawer v-model="customerDetailVisible" title="客户详情" size="620px">
      <div v-if="customerDetailRow" class="commerce-products__drawer">
        <div class="commerce-products__drawer-head">
          <div>
            <h3 class="commerce-products__title">{{ customerDetailRow.name }}</h3>
            <p class="text-secondary commerce-products__sub">
              {{ customerDetailRow.code }} · {{ customerTypeText(customerDetailRow) }}
            </p>
          </div>
          <AgriStatusTag :status="customerDetailRow.status" :map="CUSTOMER_STATUS_MAP" />
        </div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="联系人">{{
            customerDetailRow.contact
          }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">
            {{ maskPhone(customerDetailRow.phone) }}
          </el-descriptions-item>
          <el-descriptions-item label="累计订单数">
            {{ customerDetailRow.orderCount || 0 }} 笔
          </el-descriptions-item>
          <el-descriptions-item label="累计金额">
            {{ formatMoney(customerDetailRow.totalAmount) }} 元
          </el-descriptions-item>
          <el-descriptions-item label="地址" :span="2">
            {{ customerDetailRow.address || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ customerDetailRow.remark || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="commerce-products__block-title">最近 5 笔订单</h4>
        <div v-loading="customerOrdersLoading">
          <el-table :data="customerOrders" size="small" border>
            <el-table-column prop="orderNo" label="订单号" width="140" />
            <el-table-column label="商品摘要" min-width="130">
              <template #default="{ row }">{{ orderItemsSummary(row) }}</template>
            </el-table-column>
            <el-table-column label="金额" width="100" align="right">
              <template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <AgriStatusTag :status="row.status" :map="ORDER_STATUS_MAP" />
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="下单时间" width="150" />
          </el-table>
          <p
            v-if="!customerOrdersLoading && customerOrders.length === 0"
            class="commerce-products__tip text-secondary"
          >
            该客户暂无订单记录。
          </p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.commerce-products__tabs {
  :deep(.el-tabs__header) {
    margin-bottom: $space-md;
  }
}

.commerce-products__stats {
  margin-bottom: $space-md;
}

.commerce-products__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.commerce-products__section {
  margin-bottom: $space-md;
}

.commerce-products__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  width: 100%;
}

.commerce-products__actions {
  display: flex;
  gap: $space-xs;
}

.commerce-products__title {
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.commerce-products__sub {
  font-size: $font-size-xs;
}

.commerce-products__switch {
  margin: 0 $space-xs;
}

.commerce-products__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.commerce-products__drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-md;
}

.commerce-products__block-title {
  margin: $space-md 0 $space-sm;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.commerce-products__tip {
  margin-top: $space-sm;
  font-size: $font-size-xs;
}

@media (max-width: $breakpoint-sm) {
  .commerce-products__toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
