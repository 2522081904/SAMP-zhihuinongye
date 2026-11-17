<script setup>
/**
 * P018 出库与投入品台账
 * 数据来源：A14 投入品使用台账（GET/POST /supply/pesticide-logs）、A13 农资档案（GET /supply/stock）。
 * 数据缺口：
 * - mock 没有出库流水查询接口，出库记录由 A13 库存种子确定性派生，并合并本机
 *   `agri-stock-ops-v1`（P019 入库/出库时写入）中的出库操作；
 * - A14 没有「施药方式」字段，登记时写入备注 `施药方式：X`，列表按备注解析展示；
 * - A14 没有安全间隔期字段可回带，农资档案也没有该字段，登记时默认 3 天（接口默认值）。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { createPesticideLog, fetchPesticideLogs, fetchPlots, fetchStock } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmInputLedgerPage' })

const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)
const BUSINESS_TODAY = BUSINESS_NOW_TEXT.slice(0, 10)
const DAY_MS = 24 * 60 * 60 * 1000
const STOCK_OPS_KEY = 'agri-stock-ops-v1'

const activeTab = ref('outbound')
const logs = ref([])
const outRecords = ref([])
const stockItems = ref([])
const plots = ref([])
const loading = ref(false)
const loadError = ref(false)
const logPage = ref(1)
const logSize = ref(10)
const outPage = ref(1)
const outSize = ref(10)

// 登记使用弹窗
const logVisible = ref(false)
const logSubmitting = ref(false)
const logDefaults = ref({})
const logForm = reactive({ plotId: '', itemId: '' })

// 台账详情
const detailVisible = ref(false)
const detailRow = ref(null)

// 出库详情
const outDetailVisible = ref(false)
const outDetailRow = ref(null)

/** 时间串转毫秒 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 投入品是否化肥：mock 无类别字段，按名称关键词确定性推导 */
function isFertilizer(name) {
  return /肥|尿素|磷酸|钾|氮|复合|有机质/.test(String(name || ''))
}

/** 投入品类别 */
function categoryOf(log) {
  return isFertilizer(log.pesticideName) ? '化肥' : '农药'
}

/** 施药方式：从备注 `施药方式：X` 解析 */
function methodOf(log) {
  const matched = String(log.remark || '').match(/施药方式：(\S+)/)
  if (matched) {
    return matched[1]
  }
  return isFertilizer(log.pesticideName) ? '撒施' : '喷雾'
}

/** 安全间隔期剩余天数，已过返回 -1 */
function remainingDaysOf(log) {
  const end = toTimestamp(`${log.withdrawEndDate} 00:00:00`)
  const today = toTimestamp(`${BUSINESS_TODAY} 00:00:00`)
  if (!end) {
    return -1
  }
  if (end < today) {
    return -1
  }
  return Math.round((end - today) / DAY_MS)
}

/** 安全间隔期标签映射：文案带天数，所以按天数生成 key */
const intervalMap = computed(() => {
  const map = { EXPIRED: { text: '已过间隔期', type: 'success' } }
  logs.value.forEach((log) => {
    const days = remainingDaysOf(log)
    if (days >= 0) {
      map[`D${days}`] = {
        text: `间隔期 剩 ${days} 天`,
        type: days <= 1 ? 'danger' : 'warning'
      }
    }
  })
  return map
})

function intervalStatusOf(log) {
  const days = remainingDaysOf(log)
  return days < 0 ? 'EXPIRED' : `D${days}`
}

/** 投入品下拉：只列农药/化肥 */
const inputOptions = computed(() =>
  stockItems.value
    .filter((item) => item.category === 'PESTICIDE' || item.category === 'FERTILIZER')
    .map((item) => ({ label: `${item.name}（${item.spec}）`, value: item.id }))
)

const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

const logFields = computed(() => [
  { prop: 'appliedDate', label: '使用日期', type: 'date', required: true },
  { prop: 'plotId', label: '地块', type: 'select', required: true, options: plotOptions.value },
  { prop: 'itemId', label: '投入品', type: 'select', required: true, options: inputOptions.value },
  { prop: 'dose', label: '用量', type: 'number', required: true, min: 0.1 },
  { prop: 'dilution', label: '稀释倍数', type: 'number', min: 0 },
  {
    prop: 'method',
    label: '施药方式',
    type: 'select',
    required: true,
    options: [
      { label: '喷雾', value: '喷雾' },
      { label: '灌根', value: '灌根' },
      { label: '撒施', value: '撒施' }
    ]
  },
  {
    prop: 'safeIntervalDays',
    label: '安全间隔期（天）',
    type: 'number',
    min: 1,
    tip: '农资档案暂无该字段，默认 3 天，可按农药标签调整'
  },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
])

const logRules = {
  dose: [{ required: true, message: '请输入用量', trigger: 'blur' }],
  appliedDate: [{ required: true, message: '请选择使用日期', trigger: 'change' }]
}

const outColumns = [
  { prop: 'stockNo', label: '出库单号', width: 140 },
  { prop: 'itemName', label: '农资', width: 140, showOverflowTooltip: true },
  { prop: 'quantity', label: '数量', width: 80, slot: 'outQuantity' },
  { prop: 'receiver', label: '领用人', width: 80 },
  { prop: 'purpose', label: '用途', width: 140, showOverflowTooltip: true },
  { prop: 'createdAt', label: '出库时间', width: 130 },
  { prop: 'operator', label: '经办人', width: 80 },
  { prop: 'action', label: '操作', width: 80, slot: 'outAction', align: 'center' }
]

const logColumns = [
  { prop: 'appliedAt', label: '日期', width: 105, slot: 'appliedAt' },
  { prop: 'plotName', label: '地块', width: 100, showOverflowTooltip: true },
  { prop: 'crop', label: '作物', width: 80 },
  { prop: 'pesticideName', label: '投入品', width: 140, showOverflowTooltip: true },
  { prop: 'category', label: '类别', width: 70, slot: 'category' },
  { prop: 'dose', label: '用量', width: 84, slot: 'dose' },
  { prop: 'dilution', label: '稀释', width: 80 },
  { prop: 'method', label: '施药方式', width: 80 },
  { prop: 'interval', label: '间隔期', width: 118, slot: 'interval' },
  { prop: 'operator', label: '操作人', width: 70 },
  { prop: 'action', label: '操作', width: 70, slot: 'logAction', align: 'center' }
]

const pagedLogs = computed(() => {
  const start = (logPage.value - 1) * logSize.value
  return logs.value.slice(start, start + logSize.value)
})

const pagedOutRecords = computed(() => {
  const start = (outPage.value - 1) * outSize.value
  return outRecords.value.slice(start, start + outSize.value)
})

const stats = computed(() => ({
  outboundCount: outRecords.value.filter((record) =>
    String(record.createdAt).startsWith(BUSINESS_MONTH)
  ).length,
  pesticideCount: logs.value.filter(
    (log) => categoryOf(log) === '农药' && String(log.appliedAt).startsWith(BUSINESS_MONTH)
  ).length,
  riskCount: logs.value.filter((log) => categoryOf(log) === '农药' && remainingDaysOf(log) >= 0)
    .length
}))

const statCards = computed(() => [
  {
    label: '本月出库笔数',
    value: stats.value.outboundCount,
    unit: '笔',
    icon: 'Van',
    tone: 'brand'
  },
  {
    label: '农药使用次数',
    value: stats.value.pesticideCount,
    unit: '次',
    icon: 'FirstAidKit',
    tone: 'warn'
  },
  {
    label: '超间隔期采收风险',
    value: stats.value.riskCount,
    unit: '条',
    icon: 'Warning',
    tone: 'danger'
  }
])

/** 读出库种子：按库存前 8 条派生 */
function buildOutRecords(sourceItems) {
  const receivers = ['张伟', '李娜', '王强', '刘洋', '陈静', '赵磊', '孙倩', '周涛']
  const purposes = [
    '一号棚追肥',
    '番茄病虫害防治',
    '育苗基质装盘',
    '滴灌管带更换',
    '冬季清园',
    '大棚土壤消毒',
    '叶面肥喷施',
    '果园基肥施用'
  ]
  return sourceItems.slice(0, 8).map((item, index) => ({
    id: `OUT-SEED-${index + 1}`,
    stockNo: `CK-202611-${String(index + 1).padStart(3, '0')}`,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    unit: item.unit,
    quantity: 1 + (index % 4),
    receiver: receivers[index % receivers.length],
    purpose: purposes[index % purposes.length],
    operator: '仓管员 王敏',
    createdAt: `2026-11-${String(8 + index).padStart(2, '0')} ${String(9 + (index % 8)).padStart(2, '0')}:30:00`
  }))
}

/** 读取本机库存操作，筛出出库记录 */
function loadLocalOutRecords() {
  try {
    const raw = sessionStorage.getItem(STOCK_OPS_KEY)
    const ops = raw ? JSON.parse(raw) : []
    return ops
      .filter((op) => op.type === 'OUT')
      .map((op, index) => ({
        id: op.id || `LOCAL-OUT-${index + 1}`,
        stockNo: op.stockNo || `CK-LOCAL-${String(index + 1).padStart(3, '0')}`,
        itemId: op.itemId,
        itemCode: op.itemCode,
        itemName: op.itemName,
        unit: op.unit,
        quantity: op.quantity,
        receiver: op.receiver || op.operator || '-',
        purpose: op.purpose || '本机出库操作',
        operator: op.operator || '管理员',
        createdAt: op.createdAt
      }))
  } catch {
    return []
  }
}

/** 载入台账与出库记录 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [logData, stockData, plotData] = await Promise.all([
      fetchPesticideLogs({ page: 1, size: 100 }),
      fetchStock({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 100 })
    ])
    logs.value = (logData?.list || []).slice().sort((a, b) => {
      return toTimestamp(b.appliedAt) - toTimestamp(a.appliedAt)
    })
    stockItems.value = stockData?.list || []
    plots.value = plotData?.list || []
    const seeds = buildOutRecords(stockItems.value)
    outRecords.value = [...loadLocalOutRecords(), ...seeds].sort(
      (a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt)
    )
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/** 打开登记使用弹窗 */
function openRegister() {
  logForm.plotId = ''
  logForm.itemId = ''
  logDefaults.value = {
    appliedDate: BUSINESS_TODAY,
    plotId: '',
    itemId: '',
    dose: 1,
    dilution: 800,
    method: '喷雾',
    safeIntervalDays: 3,
    remark: ''
  }
  logVisible.value = true
}

/** AgriFormDialog 字段变化时同步地块/投入品，便于按地块带出作物 */
function handleLogFieldChange({ prop, value }) {
  if (prop === 'plotId') {
    logForm.plotId = value
  }
  if (prop === 'itemId') {
    logForm.itemId = value
  }
}

/** 提交登记：A14 只接收固定字段，施药方式写进备注 */
async function submitLog(payload) {
  if (logSubmitting.value) {
    return
  }
  const plot = plots.value.find((entry) => entry.id === payload.plotId)
  const item = stockItems.value.find((entry) => entry.id === payload.itemId)
  if (!plot) {
    ElMessage.warning('请选择地块')
    return
  }
  if (!item) {
    ElMessage.warning('请选择投入品')
    return
  }
  if (!payload.appliedDate) {
    ElMessage.warning('请选择使用日期')
    return
  }
  if (!Number(payload.dose)) {
    ElMessage.warning('用量必须大于 0')
    return
  }
  logSubmitting.value = true
  try {
    const remarkParts = []
    if (payload.method) {
      remarkParts.push(`施药方式：${payload.method}`)
    }
    if (String(payload.remark || '').trim()) {
      remarkParts.push(String(payload.remark).trim())
    }
    await createPesticideLog({
      pesticideName: item.name,
      activeIngredient: item.name,
      formulation: item.spec,
      dilution: payload.dilution ? `${payload.dilution} 倍液` : '',
      dose: Number(payload.dose),
      unit: 'ml/亩',
      plotId: plot.id,
      appliedAt: `${payload.appliedDate} 09:00:00`,
      operator: '管理员',
      safeIntervalDays: Number(payload.safeIntervalDays || 3),
      remark: remarkParts.join('；')
    })
    logVisible.value = false
    ElMessage.success('投入品使用已登记')
    logPage.value = 1
    await loadAll()
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('台账服务暂不可用，请稍后重试')
    }
  } finally {
    logSubmitting.value = false
  }
}

function handleLogPageChange(payload) {
  logPage.value = payload.page
  logSize.value = payload.size
}

function handleOutPageChange(payload) {
  outPage.value = payload.page
  outSize.value = payload.size
}

function openLogDetail(row) {
  detailRow.value = row
  detailVisible.value = true
}

function openOutDetail(row) {
  outDetailRow.value = row
  outDetailVisible.value = true
}

onMounted(loadAll)
</script>

<template>
  <div class="page-container input-ledger">
    <AgriPageHeader
      page-id="P018"
      title="出库与投入品台账"
      description="追踪农资出库去向与农药化肥使用记录，按安全间隔期提示采收风险。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" @click="openRegister">登记使用</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="input-ledger__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="8" :md="8">
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

    <div v-if="loadError" class="input-ledger__error" @click="loadAll">加载失败，点击重试</div>

    <div v-else class="agri-card input-ledger__section">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="出库记录" name="outbound">
          <div class="input-ledger__toolbar">
            <span class="text-secondary">共 {{ outRecords.length }} 条出库记录</span>
          </div>
          <AgriTable
            :columns="outColumns"
            :data="pagedOutRecords"
            :loading="loading"
            :total="outRecords.length"
            :page="outPage"
            :size="outSize"
            row-key="id"
            empty-text="暂无出库记录，可在库存页执行出库"
            @page-change="handleOutPageChange"
            @size-change="handleOutPageChange"
          >
            <template #outQuantity="{ row }">{{ row.quantity }} {{ row.unit }}</template>
            <template #outAction="{ row }">
              <el-button link type="primary" @click="openOutDetail(row)">查看</el-button>
            </template>
          </AgriTable>
        </el-tab-pane>

        <el-tab-pane label="投入品使用台账" name="ledger">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
            title="农药类投入品在安全间隔期内不可采收，请按标签间隔期安排采收计划。"
            class="input-ledger__alert"
          />
          <div class="input-ledger__toolbar">
            <span class="text-secondary">共 {{ logs.length }} 条使用记录</span>
          </div>
          <AgriTable
            :columns="logColumns"
            :data="pagedLogs"
            :loading="loading"
            :total="logs.length"
            :page="logPage"
            :size="logSize"
            row-key="id"
            empty-text="暂无投入品使用记录，可点击右上角「登记使用」"
            @page-change="handleLogPageChange"
            @size-change="handleLogPageChange"
          >
            <template #appliedAt="{ row }">{{ String(row.appliedAt).slice(0, 10) }}</template>
            <template #category="{ row }">
              <el-tag
                size="small"
                effect="light"
                :type="categoryOf(row) === '农药' ? 'danger' : 'primary'"
              >
                {{ categoryOf(row) }}
              </el-tag>
            </template>
            <template #dose="{ row }">{{ row.dose }} {{ row.unit }}</template>
            <template #method="{ row }">{{ methodOf(row) }}</template>
            <template #interval="{ row }">
              <AgriStatusTag :status="intervalStatusOf(row)" :map="intervalMap" />
            </template>
            <template #logAction="{ row }">
              <el-button link type="primary" @click="openLogDetail(row)">查看</el-button>
            </template>
          </AgriTable>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 登记使用：A14 只接收固定字段，施药方式写入备注 -->
    <AgriFormDialog
      v-model="logVisible"
      title="登记投入品使用"
      :fields="logFields"
      :rules="logRules"
      :default-values="logDefaults"
      :loading="logSubmitting"
      width="620px"
      submit-text="提交登记"
      @field-change="handleLogFieldChange"
      @submit="submitLog"
    />

    <!-- 台账详情 -->
    <el-dialog v-model="detailVisible" title="投入品使用详情" width="560px">
      <el-descriptions v-if="detailRow" :column="2" border size="small">
        <el-descriptions-item label="使用日期">
          {{ String(detailRow.appliedAt).slice(0, 10) }}
        </el-descriptions-item>
        <el-descriptions-item label="地块">{{ detailRow.plotName }}</el-descriptions-item>
        <el-descriptions-item label="作物">{{ detailRow.crop }}</el-descriptions-item>
        <el-descriptions-item label="投入品">{{ detailRow.pesticideName }}</el-descriptions-item>
        <el-descriptions-item label="类别">{{ categoryOf(detailRow) }}</el-descriptions-item>
        <el-descriptions-item label="用量">
          {{ detailRow.dose }} {{ detailRow.unit }}
        </el-descriptions-item>
        <el-descriptions-item label="稀释倍数">
          {{ detailRow.dilution || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="施药方式">{{ methodOf(detailRow) }}</el-descriptions-item>
        <el-descriptions-item label="安全间隔期">
          {{ detailRow.safeIntervalDays }} 天
        </el-descriptions-item>
        <el-descriptions-item label="间隔期结束">
          {{ detailRow.withdrawEndDate }}
        </el-descriptions-item>
        <el-descriptions-item label="操作人">{{ detailRow.operator }}</el-descriptions-item>
        <el-descriptions-item label="台账编号">{{ detailRow.logNo }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">
          {{ detailRow.remark || '-' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <!-- 出库详情 -->
    <el-dialog v-model="outDetailVisible" title="出库详情" width="520px">
      <el-descriptions v-if="outDetailRow" :column="2" border size="small">
        <el-descriptions-item label="出库单号">
          {{ outDetailRow.stockNo }}
        </el-descriptions-item>
        <el-descriptions-item label="农资">{{ outDetailRow.itemName }}</el-descriptions-item>
        <el-descriptions-item label="数量">
          {{ outDetailRow.quantity }} {{ outDetailRow.unit }}
        </el-descriptions-item>
        <el-descriptions-item label="领用人">{{ outDetailRow.receiver }}</el-descriptions-item>
        <el-descriptions-item label="出库时间" :span="2">
          {{ outDetailRow.createdAt }}
        </el-descriptions-item>
        <el-descriptions-item label="用途" :span="2">
          {{ outDetailRow.purpose }}
        </el-descriptions-item>
        <el-descriptions-item label="经办人">{{ outDetailRow.operator }}</el-descriptions-item>
        <el-descriptions-item label="农资编码">{{ outDetailRow.itemCode }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.input-ledger__stats {
  margin-bottom: $space-md;
}

.input-ledger__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.input-ledger__section {
  margin-bottom: $space-md;
}

.input-ledger__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: $space-sm 0;
}

.input-ledger__alert {
  margin-bottom: $space-sm;
}

.input-ledger__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}
</style>
