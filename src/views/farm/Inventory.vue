<script setup>
/**
 * P019 库存与低库存预警
 * 数据来源：A13 库存列表（GET /supply/stock）、A13 库存统计（GET /supply/statistics）、
 *           A13 出入库（POST /supply/stock）。
 * 说明：
 * - 「低库存」按 quantity <= safetyStock 口径统计（统计接口的 lowStockCount 是
 *   status!=='NORMAL' 的数量，口径不同，因此卡片用列表数据自行计算）；
 * - mock 没有库存流水查询接口，「最近入库 / 最近出库」取本机 `agri-stock-ops-v1`
 *   中该农资最近一次操作时间，未操作过显示 '-'；
 * - 每次出入库成功后把操作写入 `agri-stock-ops-v1`，供 P018 出库记录合并展示。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { changeStock, fetchStock, fetchStockStatistics } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmInventoryPage' })

const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const STOCK_OPS_KEY = 'agri-stock-ops-v1'

// 库存状态：充足/偏低/告急/断货，AgriStatusTag 内置不含这些业务态，必须传 map
const STOCK_STATUS_MAP = {
  ENOUGH: { text: '充足', type: 'success' },
  LOW: { text: '偏低', type: 'warning' },
  CRITICAL: { text: '告急', type: 'danger' },
  OUT: { text: '断货', type: 'danger' }
}

const CATEGORY_MAP = {
  SEED: { text: '种子', type: 'success' },
  FERTILIZER: { text: '化肥', type: 'primary' },
  PESTICIDE: { text: '农药', type: 'danger' },
  OTHER: { text: '其他', type: 'info' }
}

const items = ref([])
const statistics = ref({ itemCount: 0, totalValue: 0, lowStockCount: 0 })
const loading = ref(false)
const loadError = ref(false)
const onlyLowStock = ref(false)
const page = ref(1)
const size = ref(10)
const keyword = ref('')
const category = ref('')
const stockOps = ref([])

// 出入库弹窗
const stockVisible = ref(false)
const stockSubmitting = ref(false)
const stockType = ref('IN')
const stockTarget = ref(null)
const stockDefaults = ref({})

// 详情弹窗
const detailVisible = ref(false)
const detailRow = ref(null)

const categoryOptions = [
  { label: '种子', value: 'SEED' },
  { label: '化肥', value: 'FERTILIZER' },
  { label: '农药', value: 'PESTICIDE' },
  { label: '其他', value: 'OTHER' }
]

/** 数字格式化 */
function formatNumber(value) {
  return Number(value || 0).toFixed(2)
}

/** 库存状态：断货 > 告急(低于安全库存 50%) > 偏低 > 充足 */
function stockStatusOf(item) {
  const quantity = Number(item.quantity || 0)
  const safety = Number(item.safetyStock || 0)
  if (quantity <= 0) {
    return 'OUT'
  }
  if (safety > 0 && quantity < safety * 0.5) {
    return 'CRITICAL'
  }
  if (quantity <= safety) {
    return 'LOW'
  }
  return 'ENOUGH'
}

/** 库存条百分比：当前 / 安全库存，最高 100 */
function stockPercentOf(item) {
  const quantity = Number(item.quantity || 0)
  const safety = Number(item.safetyStock || 0)
  if (!safety) {
    return quantity > 0 ? 100 : 0
  }
  return Math.min(100, Math.round((quantity / safety) * 100))
}

function stockColorOf(item) {
  const status = stockStatusOf(item)
  if (status === 'OUT' || status === 'CRITICAL') {
    return 'var(--el-color-danger)'
  }
  if (status === 'LOW') {
    return 'var(--el-color-warning)'
  }
  return 'var(--el-color-success)'
}

/** 本机库存操作 */
function loadStockOps() {
  try {
    const raw = sessionStorage.getItem(STOCK_OPS_KEY)
    stockOps.value = raw ? JSON.parse(raw) : []
  } catch {
    stockOps.value = []
  }
}

/** 保存本机库存操作 */
function persistStockOps() {
  try {
    sessionStorage.setItem(STOCK_OPS_KEY, JSON.stringify(stockOps.value))
  } catch {
    // 隐私模式下不可写时只保留内存态
  }
}

/** 某农资最近一次指定类型操作时间 */
function latestOpTime(itemId, type) {
  const matched = stockOps.value
    .filter((op) => op.itemId === itemId && op.type === type)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return matched[0]?.createdAt || ''
}

const filteredItems = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const matchKeyword =
      !text ||
      [item.code, item.name, item.spec].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(text)
      )
    const matchCategory = !category.value || item.category === category.value
    const matchLow = !onlyLowStock.value || Number(item.quantity) <= Number(item.safetyStock)
    return matchKeyword && matchCategory && matchLow
  })
})

const pagedItems = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredItems.value.slice(start, start + size.value)
})

const stats = computed(() => ({
  kinds: statistics.value.itemCount || items.value.length,
  totalValue: Number(statistics.value.totalValue || 0),
  lowStock: items.value.filter((item) => Number(item.quantity) <= Number(item.safetyStock)).length,
  outOfStock: items.value.filter((item) => Number(item.quantity) <= 0).length
}))

const statCards = computed(() => [
  { label: '农资种类', value: stats.value.kinds, unit: '种', icon: 'Box', tone: 'brand' },
  {
    label: '库存总值',
    value: formatNumber(stats.value.totalValue),
    unit: '元',
    icon: 'Money',
    tone: 'ok'
  },
  { label: '低库存项', value: stats.value.lowStock, unit: '项', icon: 'Warning', tone: 'warn' },
  {
    label: '已断货项',
    value: stats.value.outOfStock,
    unit: '项',
    icon: 'CircleClose',
    tone: 'danger'
  }
])

const columns = [
  { prop: 'code', label: '编码', width: 96 },
  { prop: 'name', label: '名称', width: 112, showOverflowTooltip: true },
  { prop: 'category', label: '类别', width: 70, slot: 'category' },
  { prop: 'spec', label: '规格', width: 84, showOverflowTooltip: true },
  { prop: 'quantity', label: '当前库存', width: 104, slot: 'quantity' },
  { prop: 'safetyStock', label: '安全库存', width: 80 },
  { prop: 'status', label: '库存状态', width: 86, slot: 'status' },
  { prop: 'lastIn', label: '最近入库', width: 100, slot: 'lastIn' },
  { prop: 'lastOut', label: '最近出库', width: 100, slot: 'lastOut' },
  { prop: 'action', label: '操作', width: 110, slot: 'action', align: 'center' }
]

const emptyText = computed(() => {
  if (onlyLowStock.value) {
    return '当前没有低于安全库存的农资'
  }
  if (keyword.value || category.value) {
    return '暂无匹配农资，试试调整筛选条件'
  }
  return '暂无农资库存数据'
})

/** 载入列表与统计 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [listData, statData] = await Promise.all([
      fetchStock({ page: 1, size: 100 }),
      fetchStockStatistics()
    ])
    items.value = listData?.list || []
    statistics.value = statData || { itemCount: 0, totalValue: 0, lowStockCount: 0 }
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

function handleQueryChange() {
  page.value = 1
}

function handleResetQuery() {
  keyword.value = ''
  category.value = ''
  onlyLowStock.value = false
  page.value = 1
}

/** 打开入库/出库弹窗 */
function openStock(row, type) {
  stockTarget.value = row
  stockType.value = type
  stockDefaults.value =
    type === 'IN'
      ? { quantity: 1, price: Number(row.price || 0), supplier: '', remark: '' }
      : { quantity: 1, receiver: '', purpose: '', remark: '' }
  stockVisible.value = true
}

const stockFields = computed(() => {
  if (stockType.value === 'IN') {
    return [
      {
        prop: 'quantity',
        label: '入库数量',
        type: 'number',
        required: true,
        min: 1,
        tip: `当前库存 ${stockTarget.value?.quantity ?? 0}${stockTarget.value?.unit || ''}`
      },
      { prop: 'price', label: '单价（元）', type: 'number', min: 0 },
      { prop: 'supplier', label: '供应商', type: 'input', placeholder: '如 中化化肥' },
      { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
    ]
  }
  return [
    {
      prop: 'quantity',
      label: '出库数量',
      type: 'number',
      required: true,
      min: 1,
      tip: `当前库存 ${stockTarget.value?.quantity ?? 0}${stockTarget.value?.unit || ''}，不能超过库存`
    },
    {
      prop: 'receiver',
      label: '领用人',
      type: 'input',
      required: true,
      placeholder: '领用人员姓名'
    },
    { prop: 'purpose', label: '用途', type: 'input', placeholder: '如 一号棚追肥' },
    { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
  ]
})

const stockRules = computed(() => ({
  quantity: [{ required: true, message: '请输入数量', trigger: 'blur' }],
  ...(stockType.value === 'OUT'
    ? { receiver: [{ required: true, message: '请输入领用人', trigger: 'blur' }] }
    : {})
}))

/** 生成操作单号 */
function nextStockNo(type) {
  const prefix = type === 'IN' ? 'RK' : 'CK'
  const count = stockOps.value.filter((op) => op.type === type).length + 1
  return `${prefix}-20261116-${String(count).padStart(3, '0')}`
}

/** 提交出入库：成功后写本机流水并刷新卡片与表格 */
async function submitStock(payload) {
  const item = stockTarget.value
  if (!item || stockSubmitting.value) {
    return
  }
  const quantity = Number(payload.quantity)
  if (!quantity || quantity <= 0) {
    ElMessage.warning('数量必须大于 0')
    return
  }
  if (stockType.value === 'OUT' && quantity > Number(item.quantity)) {
    ElMessage.error(`库存不足，当前仅剩 ${item.quantity}${item.unit}`)
    return
  }
  if (stockType.value === 'OUT' && !String(payload.receiver || '').trim()) {
    ElMessage.warning('请填写领用人')
    return
  }
  stockSubmitting.value = true
  try {
    const remarkParts = []
    if (stockType.value === 'IN') {
      if (payload.supplier) {
        remarkParts.push(`供应商：${payload.supplier}`)
      }
      if (Number(payload.price) > 0) {
        remarkParts.push(`单价：${payload.price} 元`)
      }
    } else if (payload.purpose) {
      remarkParts.push(`用途：${payload.purpose}`)
    }
    if (String(payload.remark || '').trim()) {
      remarkParts.push(String(payload.remark).trim())
    }
    const result = await changeStock({
      itemId: item.id,
      type: stockType.value,
      quantity,
      operator: stockType.value === 'OUT' ? payload.receiver : '管理员',
      remark: remarkParts.join('；')
    })
    const record = {
      id: `${stockType.value}-${item.id}-${stockOps.value.length + 1}`,
      stockNo: nextStockNo(stockType.value),
      type: stockType.value,
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      unit: item.unit,
      quantity,
      beforeQuantity: Number(item.quantity || 0),
      afterQuantity: Number(
        result?.item?.quantity ??
          Number(item.quantity) + (stockType.value === 'IN' ? quantity : -quantity)
      ),
      receiver: stockType.value === 'OUT' ? payload.receiver : '',
      purpose: payload.purpose || '',
      operator: stockType.value === 'OUT' ? payload.receiver : '管理员',
      remark: remarkParts.join('；'),
      createdAt: BUSINESS_NOW_TEXT
    }
    stockOps.value = [record, ...stockOps.value]
    persistStockOps()
    stockVisible.value = false
    ElMessage.success(stockType.value === 'IN' ? '入库成功，库存已更新' : '出库成功，库存已扣减')
    await loadAll()
  } catch (err) {
    // 超库存等业务错误已由请求层提示，40401 静默
    if (err?.code === 40401) {
      ElMessage.error('库存服务暂不可用，请稍后重试')
    }
  } finally {
    stockSubmitting.value = false
  }
}

function openDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

/** CSV 单元格转义 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** 导出当前筛选结果 CSV（带 BOM，Excel 直接打开不乱码） */
function exportCsv() {
  const header = [
    '农资编码',
    '名称',
    '类别',
    '规格',
    '当前库存',
    '单位',
    '安全库存',
    '库存状态',
    '单价(元)',
    '库存金额(元)'
  ]
  const rows = filteredItems.value.map((item) => [
    item.code,
    item.name,
    CATEGORY_MAP[item.category]?.text || item.categoryName || item.category,
    item.spec,
    item.quantity,
    item.unit,
    item.safetyStock,
    STOCK_STATUS_MAP[stockStatusOf(item)].text,
    item.price,
    formatNumber(Number(item.quantity || 0) * Number(item.price || 0))
  ])
  const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `库存清单_20261116.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 条库存数据`)
}

onMounted(() => {
  loadStockOps()
  loadAll()
})
</script>

<template>
  <div class="page-container inventory">
    <AgriPageHeader
      page-id="P019"
      title="库存与低库存预警"
      description="实时掌握农资库存水位，按安全库存预警并支持入库、出库与清单导出。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button @click="exportCsv">导出 CSV</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="inventory__stats">
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

    <div class="agri-card inventory__section">
      <div class="inventory__filters">
        <el-input
          v-model="keyword"
          placeholder="农资编码 / 名称"
          clearable
          class="inventory__keyword"
          @input="handleQueryChange"
        />
        <el-select
          v-model="category"
          placeholder="全部类别"
          clearable
          class="inventory__select"
          @change="handleQueryChange"
        >
          <el-option
            v-for="option in categoryOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <div class="inventory__switch">
          <span class="text-secondary">只看低库存</span>
          <el-switch v-model="onlyLowStock" @change="handleQueryChange" />
        </div>
        <el-button link type="primary" @click="handleResetQuery">重置</el-button>
      </div>

      <div v-if="loadError" class="inventory__error" @click="loadAll">加载失败，点击重试</div>
      <AgriTable
        v-else
        :columns="columns"
        :data="pagedItems"
        :loading="loading"
        :total="filteredItems.length"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #category="{ row }">
          <AgriStatusTag :status="row.category" :map="CATEGORY_MAP" />
        </template>
        <template #quantity="{ row }">
          <div class="inventory__quantity">
            <span
              :class="{
                'inventory__quantity--danger': Number(row.quantity) <= Number(row.safetyStock)
              }"
            >
              {{ row.quantity }} {{ row.unit }}
            </span>
            <el-progress
              :percentage="stockPercentOf(row)"
              :stroke-width="4"
              :show-text="false"
              :color="stockColorOf(row)"
            />
          </div>
        </template>
        <template #status="{ row }">
          <AgriStatusTag :status="stockStatusOf(row)" :map="STOCK_STATUS_MAP" />
        </template>
        <template #lastIn="{ row }">{{ latestOpTime(row.id, 'IN') || '-' }}</template>
        <template #lastOut="{ row }">{{ latestOpTime(row.id, 'OUT') || '-' }}</template>
        <template #action="{ row }">
          <el-button link type="primary" @click="openStock(row, 'IN')">入库</el-button>
          <el-button link type="primary" @click="openStock(row, 'OUT')">出库</el-button>
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 入库 / 出库：同一表单按类型切换字段 -->
    <AgriFormDialog
      v-model="stockVisible"
      :title="stockType === 'IN' ? '农资入库' : '农资出库'"
      :fields="stockFields"
      :rules="stockRules"
      :default-values="stockDefaults"
      :loading="stockSubmitting"
      width="560px"
      :submit-text="stockType === 'IN' ? '确认入库' : '确认出库'"
      @submit="submitStock"
    />

    <!-- 库存详情 -->
    <el-dialog v-model="detailVisible" title="库存详情" width="540px">
      <el-descriptions v-if="detailRow" :column="2" border size="small">
        <el-descriptions-item label="农资编码">{{ detailRow.code }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ detailRow.name }}</el-descriptions-item>
        <el-descriptions-item label="类别">
          {{ CATEGORY_MAP[detailRow.category]?.text || detailRow.categoryName }}
        </el-descriptions-item>
        <el-descriptions-item label="规格">{{ detailRow.spec }}</el-descriptions-item>
        <el-descriptions-item label="当前库存">
          {{ detailRow.quantity }} {{ detailRow.unit }}
        </el-descriptions-item>
        <el-descriptions-item label="安全库存">
          {{ detailRow.safetyStock }} {{ detailRow.unit }}
        </el-descriptions-item>
        <el-descriptions-item label="库存状态">
          <AgriStatusTag :status="stockStatusOf(detailRow)" :map="STOCK_STATUS_MAP" />
        </el-descriptions-item>
        <el-descriptions-item label="单价">
          {{ formatNumber(detailRow.price) }} 元
        </el-descriptions-item>
        <el-descriptions-item label="供应商">{{ detailRow.supplier || '-' }}</el-descriptions-item>
        <el-descriptions-item label="仓库">{{ detailRow.warehouse || '-' }}</el-descriptions-item>
        <el-descriptions-item label="有效期至">
          {{ detailRow.expiryDate || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="最近更新">{{ detailRow.updatedAt }}</el-descriptions-item>
        <el-descriptions-item label="最近入库">
          {{ latestOpTime(detailRow.id, 'IN') || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="最近出库">
          {{ latestOpTime(detailRow.id, 'OUT') || '-' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.inventory__stats {
  margin-bottom: $space-md;
}

.inventory__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.inventory__section {
  margin-bottom: $space-md;
}

.inventory__filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.inventory__keyword {
  width: 220px;
}

.inventory__select {
  width: 150px;
}

.inventory__switch {
  display: flex;
  align-items: center;
  gap: $space-xs;
  font-size: $font-size-sm;
}

.inventory__quantity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.inventory__quantity--danger {
  color: $danger-color;
  font-weight: 600;
}

.inventory__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

@media (max-width: $breakpoint-sm) {
  .inventory__keyword,
  .inventory__select {
    width: 100%;
  }
}
</style>
