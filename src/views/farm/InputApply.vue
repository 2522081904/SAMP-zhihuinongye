<script setup>
/**
 * P017 农资档案与领用
 * 数据来源：A13 农资库存（GET /supply/stock）、A13 出库（POST /supply/stock）。
 * 数据缺口：
 * - mock 没有农资建档接口，新建农资只保存在本机 sessionStorage，刷新后仍可见但不参与 A13 统计；
 * - mock 没有领用申请/审批接口，申请单由库存种子按固定规则派生并保存在本机 sessionStorage；
 *   审批通过时才真正调用 A13 出库扣减库存（这是唯一会写服务端数据的动作）。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { changeStock, fetchStock } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmInputApplyPage' })

const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)
const ITEM_KEY = 'agri-input-items-v1'
const APPLY_KEY = 'agri-input-applies-v1'

// 农资类别：mock 用 FERTILIZER/PESTICIDE/SEED/OTHER，页面展示为种子/化肥/农药/农膜/器具口径
const CATEGORY_MAP = {
  SEED: { text: '种子', type: 'success' },
  FERTILIZER: { text: '化肥', type: 'primary' },
  PESTICIDE: { text: '农药', type: 'danger' },
  OTHER: { text: '其他', type: 'info' }
}

// 领用申请状态：AgriStatusTag 内置不含待审批/已驳回，必须传业务态 map
const APPLY_STATUS_MAP = {
  PENDING: { text: '待审批', type: 'warning' },
  APPROVED: { text: '已通过', type: 'success' },
  REJECTED: { text: '已驳回', type: 'danger' }
}

const activeTab = ref('catalog')
const items = ref([])
const applications = ref([])
const loading = ref(false)
const loadError = ref(false)
const catalogPage = ref(1)
const catalogSize = ref(10)
const applyPage = ref(1)
const applySize = ref(10)
const catalogQuery = ref({ keyword: '', category: '' })
const applyQuery = ref({ keyword: '', status: '' })

// 新建农资弹窗
const itemVisible = ref(false)
const itemSubmitting = ref(false)
const itemDefaults = ref({})
const itemFields = [
  {
    prop: 'name',
    label: '农资名称',
    type: 'input',
    required: true,
    placeholder: '如 尿素、嘧霉胺',
    tip: '名称必填，最多 30 个字'
  },
  {
    prop: 'category',
    label: '类别',
    type: 'select',
    required: true,
    options: [
      { label: '种子', value: 'SEED' },
      { label: '化肥', value: 'FERTILIZER' },
      { label: '农药', value: 'PESTICIDE' },
      { label: '其他（农膜/器具）', value: 'OTHER' }
    ]
  },
  { prop: 'spec', label: '规格', type: 'input', placeholder: '如 50kg/袋' },
  { prop: 'unit', label: '单位', type: 'input', placeholder: '如 袋、瓶、kg' },
  { prop: 'safetyStock', label: '安全库存', type: 'number', tip: '低于该数量时库存预警' },
  { prop: 'price', label: '单价（元）', type: 'number' },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
]
const itemRules = {
  name: [
    { required: true, message: '请输入农资名称', trigger: 'blur' },
    { max: 30, message: '名称最多 30 个字', trigger: 'blur' }
  ]
}

// 领用审批弹窗（自建，需要按当前库存动态校验数量）
const approveVisible = ref(false)
const approveSubmitting = ref(false)
const approveTarget = ref(null)
const approveForm = reactive({ result: 'PASS', quantity: 1, remark: '' })

const categoryOptions = [
  { label: '种子', value: 'SEED' },
  { label: '化肥', value: 'FERTILIZER' },
  { label: '农药', value: 'PESTICIDE' },
  { label: '其他', value: 'OTHER' }
]

const catalogSearchFields = [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '农资编码 / 名称',
    width: 220
  },
  {
    prop: 'category',
    label: '类别',
    type: 'select',
    options: categoryOptions,
    placeholder: '全部类别',
    width: 140
  }
]

const applySearchFields = [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '申请单号 / 申请人 / 农资',
    width: 250
  },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: '待审批', value: 'PENDING' },
      { label: '已通过', value: 'APPROVED' },
      { label: '已驳回', value: 'REJECTED' }
    ],
    placeholder: '全部状态',
    width: 140
  }
]

const catalogColumns = [
  { prop: 'code', label: '编码', width: 110 },
  { prop: 'name', label: '名称', width: 150, showOverflowTooltip: true },
  { prop: 'category', label: '类别', width: 90, slot: 'category' },
  { prop: 'spec', label: '规格', width: 110, showOverflowTooltip: true },
  { prop: 'unit', label: '单位', width: 60 },
  { prop: 'quantity', label: '当前库存', width: 90, slot: 'quantity' },
  { prop: 'safetyStock', label: '安全库存', width: 90 },
  { prop: 'price', label: '单价(元)', width: 80, slot: 'price' },
  { prop: 'action', label: '操作', width: 110, slot: 'action', align: 'center' }
]

const applyColumns = [
  { prop: 'applyNo', label: '申请单号', width: 130 },
  { prop: 'applicant', label: '申请人', width: 80 },
  { prop: 'itemName', label: '农资', width: 140, showOverflowTooltip: true },
  { prop: 'quantity', label: '数量', width: 80, slot: 'applyQuantity' },
  { prop: 'purpose', label: '用途', width: 150, showOverflowTooltip: true },
  { prop: 'createdAt', label: '申请时间', width: 130 },
  { prop: 'status', label: '状态', width: 86, slot: 'applyStatus' },
  { prop: 'action', label: '操作', width: 110, slot: 'applyAction', align: 'center' }
]

const filteredItems = computed(() => {
  const keyword = catalogQuery.value.keyword.trim().toLowerCase()
  return items.value.filter((item) => {
    const matchKeyword =
      !keyword ||
      [item.code, item.name, item.spec].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchCategory =
      !catalogQuery.value.category || item.category === catalogQuery.value.category
    return matchKeyword && matchCategory
  })
})

const pagedItems = computed(() => {
  const start = (catalogPage.value - 1) * catalogSize.value
  return filteredItems.value.slice(start, start + catalogSize.value)
})

const filteredApplications = computed(() => {
  const keyword = applyQuery.value.keyword.trim().toLowerCase()
  return applications.value.filter((apply) => {
    const matchKeyword =
      !keyword ||
      [apply.applyNo, apply.applicant, apply.itemName].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchStatus = !applyQuery.value.status || apply.status === applyQuery.value.status
    return matchKeyword && matchStatus
  })
})

const pagedApplications = computed(() => {
  const start = (applyPage.value - 1) * applySize.value
  return filteredApplications.value.slice(start, start + applySize.value)
})

const stats = computed(() => {
  const approvedAmount = applications.value
    .filter(
      (apply) => apply.status === 'APPROVED' && String(apply.createdAt).startsWith(BUSINESS_MONTH)
    )
    .reduce((sum, apply) => sum + Number(apply.quantity || 0) * Number(apply.price || 0), 0)
  return {
    kinds: items.value.length,
    totalQuantity: items.value.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    pending: applications.value.filter((apply) => apply.status === 'PENDING').length,
    amount: approvedAmount
  }
})

const statCards = computed(() => [
  { label: '农资种类', value: stats.value.kinds, unit: '种', icon: 'Box', tone: 'brand' },
  {
    label: '在库总量',
    value: stats.value.totalQuantity,
    unit: '件',
    icon: 'Goods',
    tone: 'ok'
  },
  {
    label: '待审批领用',
    value: stats.value.pending,
    unit: '单',
    icon: 'DocumentChecked',
    tone: 'warn'
  },
  {
    label: '本月领用金额',
    value: stats.value.amount.toFixed(2),
    unit: '元',
    icon: 'Money',
    tone: 'brand'
  }
])

/** 金额展示 */
function formatMoney(value) {
  return Number(value || 0).toFixed(2)
}

/** 生成领用申请种子：按库存前若干条确定性派生，保证农资名真实存在 */
function buildApplications(sourceItems) {
  const applicants = ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊']
  const purposes = [
    '三号棚追肥使用',
    '番茄灰霉病防治',
    '育苗基质消毒',
    '滴灌管网维修',
    '冬季清园作业',
    '大棚放风降湿配套'
  ]
  const picks = [0, 2, 5, 8, 11, 14].filter((index) => sourceItems[index])
  return picks.map((index, order) => {
    const item = sourceItems[index]
    const status = order < 3 ? 'PENDING' : order < 5 ? 'APPROVED' : 'REJECTED'
    return {
      id: `APP-${order + 1}`,
      applyNo: `LY-202611-${String(order + 1).padStart(3, '0')}`,
      applicant: applicants[order % applicants.length],
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      unit: item.unit,
      price: item.price,
      quantity: 2 + (order % 3),
      purpose: purposes[order % purposes.length],
      createdAt: `2026-11-${String(9 + order).padStart(2, '0')} ${String(9 + order).padStart(2, '0')}:20:00`,
      status,
      approver: status === 'PENDING' ? '' : '管理员',
      approvedAt:
        status === 'PENDING' ? '' : `2026-11-${String(10 + order).padStart(2, '0')} 10:00:00`,
      rejectReason: status === 'REJECTED' ? '用途说明不完整，请补充后重新申请' : ''
    }
  })
}

/** 读取本机新建农资 */
function loadLocalItems() {
  try {
    const raw = sessionStorage.getItem(ITEM_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** 保存本机新建农资 */
function persistLocalItems() {
  try {
    sessionStorage.setItem(
      ITEM_KEY,
      JSON.stringify(items.value.filter((item) => item.localCreated))
    )
  } catch {
    // 隐私模式下不可写时只保留内存态
  }
}

/** 保存领用申请 */
function persistApplications() {
  try {
    sessionStorage.setItem(APPLY_KEY, JSON.stringify(applications.value))
  } catch {
    // 隐私模式下不可写时只保留内存态
  }
}

/** 载入库存与申请单 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const data = await fetchStock({ page: 1, size: 100 })
    const remoteItems = data?.list || []
    const localItems = loadLocalItems()
    items.value = [...localItems, ...remoteItems]

    let stored = []
    try {
      const raw = sessionStorage.getItem(APPLY_KEY)
      stored = raw ? JSON.parse(raw) : []
    } catch {
      stored = []
    }
    if (stored.length) {
      applications.value = stored
    } else {
      applications.value = buildApplications(remoteItems)
      persistApplications()
    }
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

function handleCatalogSearch() {
  catalogPage.value = 1
}

function handleCatalogReset() {
  catalogQuery.value = { keyword: '', category: '' }
  catalogPage.value = 1
}

function handleApplySearch() {
  applyPage.value = 1
}

function handleApplyReset() {
  applyQuery.value = { keyword: '', status: '' }
  applyPage.value = 1
}

function handleCatalogPageChange(payload) {
  catalogPage.value = payload.page
  catalogSize.value = payload.size
}

function handleApplyPageChange(payload) {
  applyPage.value = payload.page
  applySize.value = payload.size
}

/** 打开新建农资弹窗 */
function openCreateItem() {
  itemDefaults.value = {
    name: '',
    category: 'FERTILIZER',
    spec: '',
    unit: '袋',
    safetyStock: 10,
    price: 0,
    remark: ''
  }
  itemVisible.value = true
}

/** 新建农资：没有建档接口，写入本机存储并插入列表首位 */
function submitItem(payload) {
  const name = String(payload.name || '').trim()
  if (!name) {
    ElMessage.warning('请输入农资名称')
    return
  }
  if (name.length > 30) {
    ElMessage.warning('名称最多 30 个字')
    return
  }
  itemSubmitting.value = true
  const nextIndex = items.value.length + 1
  const newItem = {
    id: `LOCAL-20261116-${String(nextIndex).padStart(3, '0')}`,
    localCreated: true,
    code: `AG-LOCAL-${String(nextIndex).padStart(3, '0')}`,
    name,
    category: payload.category || 'OTHER',
    categoryName:
      categoryOptions.find((option) => option.value === payload.category)?.label || '其他',
    spec: String(payload.spec || '').trim() || '-',
    unit: String(payload.unit || '').trim() || '件',
    quantity: 0,
    safetyStock: Number(payload.safetyStock || 0),
    price: Number(payload.price || 0),
    supplier: '-',
    warehouse: '本机登记',
    status: 'OUT',
    statusName: '缺货',
    updatedAt: BUSINESS_NOW_TEXT
  }
  items.value = [newItem, ...items.value]
  persistLocalItems()
  itemSubmitting.value = false
  itemVisible.value = false
  ElMessage.success(`农资「${name}」已登记（本机保存，待后端建档接口上线后同步）`)
  activeTab.value = 'catalog'
  catalogPage.value = 1
}

/** 领用审批入口 */
function openApprove(row) {
  if (row.status !== 'PENDING') {
    ElMessage.info('该申请单已审批完成')
    return
  }
  const item = items.value.find((entry) => entry.id === row.itemId)
  if (!item) {
    ElMessage.error('未找到对应农资，无法审批')
    return
  }
  if (Number(item.quantity) <= 0) {
    ElMessage.error(`库存不足，当前仅剩 0${item.unit}`)
    return
  }
  approveTarget.value = row
  approveForm.result = 'PASS'
  approveForm.quantity = Number(row.quantity)
  approveForm.remark = ''
  approveVisible.value = true
}

const approveStockTip = computed(() => {
  if (!approveTarget.value) {
    return ''
  }
  const item = items.value.find((entry) => entry.id === approveTarget.value.itemId)
  return item ? `当前库存 ${item.quantity}${item.unit}，批准数量不能超过库存` : ''
})

/** 提交审批：通过时调用 A13 出库扣减库存 */
async function submitApprove() {
  const target = approveTarget.value
  if (!target || approveSubmitting.value) {
    return
  }
  const item = items.value.find((entry) => entry.id === target.itemId)
  if (!item) {
    ElMessage.error('未找到对应农资，无法审批')
    return
  }
  if (approveForm.result === 'PASS') {
    const quantity = Number(approveForm.quantity)
    if (!quantity || quantity <= 0) {
      ElMessage.warning('批准数量必须大于 0')
      return
    }
    if (quantity > Number(item.quantity)) {
      ElMessage.error(`库存不足，当前仅剩 ${item.quantity}${item.unit}`)
      return
    }
    approveSubmitting.value = true
    try {
      await changeStock({
        itemId: item.id,
        type: 'OUT',
        quantity,
        operator: target.applicant,
        remark: `领用申请 ${target.applyNo}`
      })
      target.status = 'APPROVED'
      target.quantity = quantity
      target.approver = '管理员'
      target.approvedAt = BUSINESS_NOW_TEXT
      target.rejectReason = ''
      persistApplications()
      approveVisible.value = false
      ElMessage.success('已通过领用申请并完成出库')
      await loadAll()
    } catch (err) {
      // 非 40401 的业务错误已由请求层统一提示
      if (err?.code === 40401) {
        ElMessage.error('库存服务暂不可用，请稍后重试')
      }
    } finally {
      approveSubmitting.value = false
    }
    return
  }

  target.status = 'REJECTED'
  target.approver = '管理员'
  target.approvedAt = BUSINESS_NOW_TEXT
  target.rejectReason = String(approveForm.remark || '').trim() || '审批未通过'
  persistApplications()
  approveVisible.value = false
  ElMessage.success('已驳回该领用申请')
}

/** 查看农资详情 */
function viewItem(row) {
  ElMessage.info(
    `${row.name}：编码 ${row.code}，当前库存 ${row.quantity}${row.unit}，安全库存 ${row.safetyStock}${row.unit}`
  )
}

/** 查看申请详情 */
function viewApply(row) {
  ElMessage.info(
    `${row.applyNo}：${row.applicant} 申请 ${row.itemName} ${row.quantity}${row.unit}，用途 ${row.purpose}`
  )
}

onMounted(loadAll)
</script>

<template>
  <div class="page-container input-apply">
    <AgriPageHeader
      page-id="P017"
      title="农资档案与领用"
      description="维护种子、化肥、农药等农资档案，处理领用申请并实时校验库存。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" @click="openCreateItem">新建农资</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="input-apply__stats">
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

    <div v-if="loadError" class="input-apply__error" @click="loadAll">加载失败，点击重试</div>

    <div v-else class="agri-card input-apply__section">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="农资档案" name="catalog">
          <AgriSearchBar
            v-model="catalogQuery"
            :fields="catalogSearchFields"
            :loading="loading"
            @search="handleCatalogSearch"
            @reset="handleCatalogReset"
          />
          <div class="input-apply__toolbar">
            <span class="text-secondary">共 {{ filteredItems.length }} 种农资</span>
          </div>
          <AgriTable
            :columns="catalogColumns"
            :data="pagedItems"
            :loading="loading"
            :total="filteredItems.length"
            :page="catalogPage"
            :size="catalogSize"
            row-key="id"
            empty-text="暂无农资档案，可点击右上角「新建农资」登记"
            @page-change="handleCatalogPageChange"
            @size-change="handleCatalogPageChange"
          >
            <template #category="{ row }">
              <AgriStatusTag :status="row.category" :map="CATEGORY_MAP" />
            </template>
            <template #quantity="{ row }">
              <span
                :class="{ 'input-apply__danger': Number(row.quantity) <= Number(row.safetyStock) }"
              >
                {{ row.quantity }} {{ row.unit }}
              </span>
            </template>
            <template #price="{ row }">{{ formatMoney(row.price) }}</template>
            <template #action="{ row }">
              <el-button link type="primary" @click="viewItem(row)">详情</el-button>
            </template>
          </AgriTable>
        </el-tab-pane>

        <el-tab-pane label="领用申请" name="apply">
          <AgriSearchBar
            v-model="applyQuery"
            :fields="applySearchFields"
            :loading="loading"
            @search="handleApplySearch"
            @reset="handleApplyReset"
          />
          <div class="input-apply__toolbar">
            <span class="text-secondary">共 {{ filteredApplications.length }} 条领用申请</span>
          </div>
          <AgriTable
            :columns="applyColumns"
            :data="pagedApplications"
            :loading="loading"
            :total="filteredApplications.length"
            :page="applyPage"
            :size="applySize"
            row-key="id"
            empty-text="暂无领用申请，可调整筛选条件后再试"
            @page-change="handleApplyPageChange"
            @size-change="handleApplyPageChange"
          >
            <template #applyQuantity="{ row }">{{ row.quantity }} {{ row.unit }}</template>
            <template #applyStatus="{ row }">
              <AgriStatusTag :status="row.status" :map="APPLY_STATUS_MAP" />
            </template>
            <template #applyAction="{ row }">
              <el-button
                v-if="row.status === 'PENDING'"
                link
                type="primary"
                @click="openApprove(row)"
              >
                审批
              </el-button>
              <el-button link type="primary" @click="viewApply(row)">详情</el-button>
            </template>
          </AgriTable>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 新建农资：无建档接口，仅本机保存 -->
    <AgriFormDialog
      v-model="itemVisible"
      title="新建农资"
      :fields="itemFields"
      :rules="itemRules"
      :default-values="itemDefaults"
      :loading="itemSubmitting"
      width="560px"
      submit-text="保存"
      @submit="submitItem"
    />

    <!-- 领用审批：自建弹窗，数量按当前库存动态校验 -->
    <el-dialog v-model="approveVisible" title="领用审批" width="520px">
      <div v-if="approveTarget" class="input-apply__approve">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="申请单号">
            {{ approveTarget.applyNo }}
          </el-descriptions-item>
          <el-descriptions-item label="申请人">{{ approveTarget.applicant }}</el-descriptions-item>
          <el-descriptions-item label="农资">{{ approveTarget.itemName }}</el-descriptions-item>
          <el-descriptions-item label="申请数量">
            {{ approveTarget.quantity }} {{ approveTarget.unit }}
          </el-descriptions-item>
          <el-descriptions-item label="用途" :span="2">
            {{ approveTarget.purpose }}
          </el-descriptions-item>
        </el-descriptions>

        <el-form label-width="90px" class="input-apply__approve-form">
          <el-form-item label="审批结果" required>
            <el-radio-group v-model="approveForm.result">
              <el-radio value="PASS">通过</el-radio>
              <el-radio value="REJECT">驳回</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="approveForm.result === 'PASS'" label="批准数量">
            <el-input-number v-model="approveForm.quantity" :min="1" :step="1" />
            <span class="input-apply__stock-tip">{{ approveStockTip }}</span>
          </el-form-item>
          <el-form-item v-else label="驳回原因">
            <el-input
              v-model="approveForm.remark"
              type="textarea"
              :rows="3"
              placeholder="请填写驳回原因"
            />
          </el-form-item>
          <el-form-item v-if="approveForm.result === 'PASS'" label="审批意见">
            <el-input v-model="approveForm.remark" type="textarea" :rows="2" placeholder="选填" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="primary" :loading="approveSubmitting" @click="submitApprove">
          确认审批
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.input-apply__stats {
  margin-bottom: $space-md;
}

.input-apply__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.input-apply__section {
  margin-bottom: $space-md;
}

.input-apply__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: $space-sm 0;
}

.input-apply__danger {
  color: $danger-color;
  font-weight: 600;
}

.input-apply__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.input-apply__approve-form {
  margin-top: $space-md;
}

.input-apply__stock-tip {
  margin-left: $space-sm;
  font-size: $font-size-xs;
  color: $text-secondary;
}

@media (max-width: $breakpoint-sm) {
  .input-apply__toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: $space-xs;
  }
}
</style>
