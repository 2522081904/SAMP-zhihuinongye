<script setup>
/**
 * P020 采收批次登记
 * 数据来源：A15 采收批次（GET/POST /harvest/batches）、A16 溯源码（POST /trace/codes、
 *           GET /trace/batches/{batchNo}/codes）、A18 检测报告（GET /trace/inspections、
 *           POST /trace/inspections）。
 * 数据缺口与限制：
 * - A15 种子批次只覆盖前 4 块地（PLOT-01~04），登记弹窗只提供这 4 块地并给出提示，
 *   筛选其他地块时列表为空，空态文案会说明覆盖范围；
 * - 检测报告只有部分批次存在，没有报告时详情抽屉展示「暂无检测报告」空态；
 * - 「登记检测」按 A18 要求提交一条检测项目（农药残留），据此写入结论并同步批次状态。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  createHarvestBatch,
  createInspection,
  fetchBatchTraceCodes,
  fetchHarvestBatches,
  fetchInspections,
  fetchPlots,
  generateTraceCodes
} from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmHarvestRegisterPage' })

const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)
const BUSINESS_TODAY = BUSINESS_NOW_TEXT.slice(0, 10)

// 采收批次状态：AgriStatusTag 内置不含「待检测/检测中/检测不合格」，必须传业务态 map
const BATCH_STATUS_MAP = {
  PENDING: { text: '待检测', type: 'warning' },
  INSPECTING: { text: '检测中', type: 'primary' },
  QUALIFIED: { text: '检测合格', type: 'success' },
  REJECTED: { text: '检测不合格', type: 'danger' }
}

// 溯源赋码状态
const TRACE_STATUS_MAP = {
  HAS: { text: '已赋码', type: 'success' },
  NONE: { text: '未赋码', type: 'info' }
}

const query = ref({ keyword: '', plotId: '', crop: '', status: '', dateRange: [] })
const page = ref(1)
const size = ref(10)
const batches = ref([])
const plots = ref([])
const loading = ref(false)
const loadError = ref(false)
const createVisible = ref(false)
const createSubmitting = ref(false)
const createDefaults = ref({})
const createFormRef = ref(null)

// 生成溯源码弹窗
const traceVisible = ref(false)
const traceSubmitting = ref(false)
const traceTarget = ref(null)
const traceCount = ref(50)

// 登记检测弹窗
const inspectVisible = ref(false)
const inspectSubmitting = ref(false)
const inspectTarget = ref(null)
const inspectForm = reactive({ conclusion: 'PASS', inspector: '管理员' })

// 详情抽屉
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailBatch = ref(null)
const detailInspections = ref([])
const detailCodes = ref([])
const showAllCodes = ref(false)

/** 只有前 4 块地有 A15 批次数据 */
const supportedPlots = computed(() => plots.value.slice(0, 4))
const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)
const supportedPlotOptions = computed(() =>
  supportedPlots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

const cropOptions = computed(() => {
  const crops = [...new Set(plots.value.map((plot) => plot.crop).filter(Boolean))]
  return crops.map((crop) => ({ label: crop, value: crop }))
})

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '批次号 / 地块',
    width: 220
  },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plotOptions.value,
    width: 210
  },
  {
    prop: 'crop',
    label: '作物',
    type: 'select',
    placeholder: '全部作物',
    options: cropOptions.value,
    width: 130
  },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '待检测', value: 'PENDING' },
      { label: '检测中', value: 'INSPECTING' },
      { label: '检测合格', value: 'QUALIFIED' },
      { label: '检测不合格', value: 'REJECTED' }
    ],
    width: 140
  },
  { prop: 'dateRange', label: '采收日期', type: 'daterange' }
])

const columns = [
  { prop: 'batchNo', label: '批次号', width: 130 },
  { prop: 'plotName', label: '地块', width: 100, showOverflowTooltip: true },
  { prop: 'crop', label: '作物', width: 76 },
  { prop: 'harvestDate', label: '采收日期', width: 104 },
  { prop: 'quantityKg', label: '重量(kg)', width: 90, slot: 'quantityKg' },
  { prop: 'grade', label: '等级', width: 64 },
  { prop: 'status', label: '检测状态', width: 96, slot: 'status' },
  { prop: 'traceCodeCount', label: '溯源码', width: 80, slot: 'traceCodeCount', align: 'center' },
  { prop: 'traceState', label: '状态', width: 86, slot: 'traceState' },
  { prop: 'action', label: '操作', width: 180, slot: 'action', align: 'center' }
]

/** 创建批次表单：地块只开放 A15 覆盖的前 4 块 */
const createFields = computed(() => [
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    required: true,
    options: supportedPlotOptions.value,
    tip: 'A15 当前只覆盖 1~4 号地块，其他地块暂无批次数据',
    span: 2
  },
  {
    prop: 'crop',
    label: '作物',
    type: 'select',
    required: true,
    options: cropOptions.value,
    tip: '选择地块后自动带出作物，可手动调整'
  },
  { prop: 'harvestDate', label: '采收日期', type: 'date', required: true },
  { prop: 'quantityKg', label: '重量(kg)', type: 'number', required: true, min: 0.1 },
  {
    prop: 'grade',
    label: '等级',
    type: 'select',
    options: [
      { label: '特级', value: '特级' },
      { label: '一级', value: '一级' },
      { label: '二级', value: '二级' }
    ]
  },
  { prop: 'operator', label: '采收人', type: 'input', placeholder: '采收人员姓名' },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
])

const createRules = {
  plotId: [{ required: true, message: '请选择地块', trigger: 'change' }],
  crop: [{ required: true, message: '请选择作物', trigger: 'change' }],
  harvestDate: [{ required: true, message: '请选择采收日期', trigger: 'change' }],
  quantityKg: [{ required: true, message: '请输入采收重量', trigger: 'blur' }]
}

const filteredBatches = computed(() => {
  const keyword = query.value.keyword.trim().toLowerCase()
  const from = query.value.dateRange?.[0]?.slice(0, 10) || ''
  const to = query.value.dateRange?.[1]?.slice(0, 10) || ''
  return batches.value.filter((batch) => {
    const matchKeyword =
      !keyword ||
      [batch.batchNo, batch.plotName].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchPlot = !query.value.plotId || batch.plotId === query.value.plotId
    const matchCrop = !query.value.crop || batch.crop === query.value.crop
    const matchStatus = !query.value.status || batch.status === query.value.status
    const date = String(batch.harvestDate || '').slice(0, 10)
    const matchDate = (!from || date >= from) && (!to || date <= to)
    return matchKeyword && matchPlot && matchCrop && matchStatus && matchDate
  })
})

const pagedBatches = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredBatches.value.slice(start, start + size.value)
})

const stats = computed(() => ({
  monthCount: batches.value.filter((batch) => String(batch.harvestDate).startsWith(BUSINESS_MONTH))
    .length,
  pendingInspect: batches.value.filter((batch) => batch.status === 'PENDING').length,
  traced: batches.value.filter((batch) => Number(batch.traceCodeCount) > 0).length,
  totalWeight: batches.value
    .filter((batch) => String(batch.harvestDate).startsWith(BUSINESS_MONTH))
    .reduce((sum, batch) => sum + Number(batch.quantityKg || 0), 0)
}))

const statCards = computed(() => [
  {
    label: '本月批次数',
    value: stats.value.monthCount,
    unit: '批',
    icon: 'Files',
    tone: 'brand'
  },
  {
    label: '待检测',
    value: stats.value.pendingInspect,
    unit: '批',
    icon: 'Search',
    tone: 'warn'
  },
  { label: '已赋码', value: stats.value.traced, unit: '批', icon: 'Ticket', tone: 'ok' },
  {
    label: '总重量',
    value: stats.value.totalWeight.toFixed(1),
    unit: 'kg',
    icon: 'ScaleToOriginal',
    tone: 'brand'
  }
])

const emptyText = computed(() => {
  const hasFilter =
    query.value.keyword ||
    query.value.plotId ||
    query.value.crop ||
    query.value.status ||
    (query.value.dateRange && query.value.dateRange.length)
  if (hasFilter) {
    return '暂无匹配批次；A15 批次数据仅覆盖 PLOT-01~PLOT-04，可选其他地块后重试'
  }
  return '暂无采收批次，可点击右上角「登记批次」'
})

/** 批次编号 */
function traceStateOf(batch) {
  return Number(batch.traceCodeCount) > 0 ? 'HAS' : 'NONE'
}

/** 载入批次与地块 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [batchData, plotData] = await Promise.all([
      fetchHarvestBatches({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 100 })
    ])
    batches.value = batchData?.list || []
    plots.value = plotData?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
}

function handleReset() {
  query.value = { keyword: '', plotId: '', crop: '', status: '', dateRange: [] }
  page.value = 1
}

function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

/** 打开登记批次弹窗 */
function openCreate() {
  createDefaults.value = {
    plotId: '',
    crop: '',
    harvestDate: BUSINESS_TODAY,
    quantityKg: 100,
    grade: '一级',
    operator: '',
    remark: ''
  }
  createVisible.value = true
}

/** 地块变化时自动带出作物 */
function handleCreateFieldChange({ prop, value }) {
  if (prop === 'plotId') {
    const plot = plots.value.find((entry) => entry.id === value)
    if (plot?.crop) {
      createFormRef.value?.setField('crop', plot.crop)
    }
  }
}

/** 提交登记：成功行插入首位并同步统计 */
async function submitCreate(payload) {
  if (createSubmitting.value) {
    return
  }
  if (!payload.plotId) {
    ElMessage.warning('请选择地块')
    return
  }
  if (!payload.crop) {
    ElMessage.warning('请选择作物')
    return
  }
  if (!(Number(payload.quantityKg) > 0)) {
    ElMessage.warning('采收重量必须大于 0')
    return
  }
  createSubmitting.value = true
  try {
    const batch = await createHarvestBatch({
      plotId: payload.plotId,
      crop: payload.crop,
      harvestDate: payload.harvestDate,
      quantityKg: Number(payload.quantityKg),
      grade: payload.grade || '一级',
      operator: String(payload.operator || '').trim() || '管理员',
      remark: String(payload.remark || '').trim()
    })
    batches.value = [batch, ...batches.value]
    createVisible.value = false
    page.value = 1
    ElMessage.success(`批次 ${batch.batchNo} 已登记`)
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('批次服务暂不可用，请稍后重试')
    }
  } finally {
    createSubmitting.value = false
  }
}

/** 打开生成溯源码弹窗 */
function openTrace(row) {
  traceTarget.value = row
  traceCount.value = 50
  traceVisible.value = true
}

/** 生成溯源码：A16 count 1~100，成功后本行溯源码数量累加 */
async function submitTrace() {
  const batch = traceTarget.value
  if (!batch || traceSubmitting.value) {
    return
  }
  const count = Number(traceCount.value)
  if (!count || count < 1 || count > 100) {
    ElMessage.warning('溯源码数量需在 1~100 之间')
    return
  }
  traceSubmitting.value = true
  try {
    const result = await generateTraceCodes({ batchNo: batch.batchNo, count })
    const added = Number(result?.count || count)
    // mock 返回的是库内同一对象，A16 已在服务端累加；这里重新拉取以服务端数量为准，
    // 避免共享引用导致页面再累加一次（真实接口若返回最新批次可改为直接赋值）。
    traceVisible.value = false
    await loadAll()
    ElMessage.success(`已生成 ${added} 个溯源码`)
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('溯源码服务暂不可用，请稍后重试')
    }
  } finally {
    traceSubmitting.value = false
  }
}

/** 打开登记检测弹窗 */
function openInspect(row) {
  inspectTarget.value = row
  inspectForm.conclusion = 'PASS'
  inspectForm.inspector = '管理员'
  inspectVisible.value = true
}

/** 登记检测：按 A18 要求提交一条检测项目，并同步批次状态 */
async function submitInspect() {
  const batch = inspectTarget.value
  if (!batch || inspectSubmitting.value) {
    return
  }
  const passed = inspectForm.conclusion === 'PASS'
  inspectSubmitting.value = true
  try {
    await createInspection({
      batchId: batch.id,
      batchNo: batch.batchNo,
      sampleName: `${batch.crop}（${batch.plotName}）`,
      sampleSource: batch.plotName,
      inspectItems: [
        {
          name: '农药残留',
          value: passed ? 0.02 : 0.08,
          limit: 0.05,
          unit: 'mg/kg'
        }
      ],
      inspector: inspectForm.inspector || '管理员',
      inspectedAt: BUSINESS_NOW_TEXT
    })
    batch.status = passed ? 'QUALIFIED' : 'REJECTED'
    inspectVisible.value = false
    ElMessage.success(passed ? '检测报告已登记，批次判定合格' : '检测报告已登记，批次判定不合格')
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('检测服务暂不可用，请稍后重试')
    }
  } finally {
    inspectSubmitting.value = false
  }
}

/** 打开详情抽屉：并行拉检测报告与溯源码 */
async function openDetail(row) {
  detailBatch.value = row
  detailVisible.value = true
  detailLoading.value = true
  showAllCodes.value = false
  detailInspections.value = []
  detailCodes.value = []
  try {
    const [inspectionData, codeData] = await Promise.all([
      fetchInspections({ batchNo: row.batchNo, page: 1, size: 20 }),
      fetchBatchTraceCodes(row.batchNo)
    ])
    detailInspections.value = inspectionData?.list || []
    detailCodes.value = codeData?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('详情加载失败，请稍后重试')
    }
  } finally {
    detailLoading.value = false
  }
}

const visibleCodes = computed(() =>
  showAllCodes.value ? detailCodes.value : detailCodes.value.slice(0, 10)
)

onMounted(loadAll)
</script>

<template>
  <div class="page-container harvest-register">
    <AgriPageHeader
      page-id="P020"
      title="采收批次登记"
      description="登记地块采收批次，跟踪检测状态与溯源码赋码情况。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" @click="openCreate">登记批次</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="harvest-register__stats">
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

    <div class="agri-card harvest-register__section">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card harvest-register__section">
      <div class="harvest-register__toolbar">
        <h3 class="harvest-register__title">批次列表</h3>
        <span class="text-secondary">共 {{ filteredBatches.length }} 个批次</span>
      </div>
      <div v-if="loadError" class="harvest-register__error" @click="loadAll">
        加载失败，点击重试
      </div>
      <AgriTable
        v-else
        :columns="columns"
        :data="pagedBatches"
        :loading="loading"
        :total="filteredBatches.length"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #quantityKg="{ row }">{{ Number(row.quantityKg).toFixed(1) }}</template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="BATCH_STATUS_MAP" />
        </template>
        <template #traceCodeCount="{ row }">{{ row.traceCodeCount ?? 0 }}</template>
        <template #traceState="{ row }">
          <AgriStatusTag :status="traceStateOf(row)" :map="TRACE_STATUS_MAP" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" @click="openInspect(row)">登记检测</el-button>
          <el-button link type="primary" @click="openTrace(row)">生成溯源码</el-button>
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 登记批次：地块只开放 A15 覆盖的前 4 块 -->
    <AgriFormDialog
      ref="createFormRef"
      v-model="createVisible"
      title="登记采收批次"
      :fields="createFields"
      :rules="createRules"
      :default-values="createDefaults"
      :loading="createSubmitting"
      width="600px"
      submit-text="登记批次"
      @field-change="handleCreateFieldChange"
      @submit="submitCreate"
    />

    <!-- 生成溯源码 -->
    <el-dialog v-model="traceVisible" title="生成溯源码" width="460px">
      <div v-if="traceTarget" class="harvest-register__trace">
        <p class="harvest-register__trace-line">
          批次 <strong>{{ traceTarget.batchNo }}</strong> 当前已有
          {{ traceTarget.traceCodeCount ?? 0 }} 个溯源码。
        </p>
        <el-form label-width="90px">
          <el-form-item label="生成数量" required>
            <el-input-number v-model="traceCount" :min="1" :max="100" :step="10" />
            <span class="harvest-register__trace-tip">单次 1~100 个</span>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="traceVisible = false">取消</el-button>
        <el-button type="primary" :loading="traceSubmitting" @click="submitTrace">
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <!-- 登记检测（A18） -->
    <el-dialog v-model="inspectVisible" title="登记检测" width="480px">
      <div v-if="inspectTarget" class="harvest-register__inspect">
        <el-form label-width="90px">
          <el-form-item label="批次号">{{ inspectTarget.batchNo }}</el-form-item>
          <el-form-item label="检测结论" required>
            <el-radio-group v-model="inspectForm.conclusion">
              <el-radio value="PASS">合格</el-radio>
              <el-radio value="FAIL">不合格</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="检测人">
            <el-input v-model="inspectForm.inspector" placeholder="检测人员姓名" />
          </el-form-item>
        </el-form>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="将按「农药残留」项目提交一条检测记录，结论会同步到批次状态。"
        />
      </div>
      <template #footer>
        <el-button @click="inspectVisible = false">取消</el-button>
        <el-button type="primary" :loading="inspectSubmitting" @click="submitInspect">
          提交检测
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉：批次信息 + 检测报告 + 溯源码 -->
    <el-drawer v-model="detailVisible" title="采收批次详情" size="620px">
      <div v-loading="detailLoading" class="harvest-register__detail">
        <template v-if="detailBatch">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="批次号">{{ detailBatch.batchNo }}</el-descriptions-item>
            <el-descriptions-item label="地块">{{ detailBatch.plotName }}</el-descriptions-item>
            <el-descriptions-item label="作物">{{ detailBatch.crop }}</el-descriptions-item>
            <el-descriptions-item label="品种">{{
              detailBatch.variety || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="采收日期">
              {{ detailBatch.harvestDate }}
            </el-descriptions-item>
            <el-descriptions-item label="重量">
              {{ Number(detailBatch.quantityKg).toFixed(1) }} kg
            </el-descriptions-item>
            <el-descriptions-item label="等级">{{ detailBatch.grade }}</el-descriptions-item>
            <el-descriptions-item label="检测状态">
              <AgriStatusTag :status="detailBatch.status" :map="BATCH_STATUS_MAP" />
            </el-descriptions-item>
            <el-descriptions-item label="溯源码数量">
              {{ detailBatch.traceCodeCount ?? 0 }}
            </el-descriptions-item>
            <el-descriptions-item label="采收人">
              {{ detailBatch.operator || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">
              {{ detailBatch.remark || '-' }}
            </el-descriptions-item>
          </el-descriptions>

          <h4 class="harvest-register__detail-title">关联检测报告</h4>
          <AgriEmpty
            v-if="!detailLoading && !detailInspections.length"
            description="暂无检测报告"
            :height="120"
          />
          <div v-else class="harvest-register__reports">
            <div
              v-for="report in detailInspections"
              :key="report.id"
              class="harvest-register__report"
            >
              <div class="harvest-register__report-head">
                <span class="harvest-register__report-no">{{ report.reportNo }}</span>
                <AgriStatusTag
                  :status="report.conclusion"
                  :map="{
                    PASS: { text: '合格', type: 'success' },
                    FAIL: { text: '不合格', type: 'danger' }
                  }"
                />
              </div>
              <div class="harvest-register__report-meta">
                检测机构：{{ report.lab || '-' }} ｜ 检测人：{{ report.inspector || '-' }} ｜
                {{ report.inspectedAt || '-' }}
              </div>
              <el-table :data="report.inspectItems || []" size="small" border>
                <el-table-column prop="name" label="检测项目" min-width="110" />
                <el-table-column prop="value" label="检测值" width="80" />
                <el-table-column prop="limit" label="限量" width="80" />
                <el-table-column prop="unit" label="单位" width="80" />
                <el-table-column prop="result" label="判定" width="70" />
              </el-table>
            </div>
          </div>

          <h4 class="harvest-register__detail-title">溯源码列表</h4>
          <AgriEmpty
            v-if="!detailLoading && !detailCodes.length"
            description="暂无溯源码，可在列表中点击「生成溯源码」"
            :height="110"
          />
          <template v-else>
            <el-table :data="visibleCodes" size="small" border>
              <el-table-column prop="code" label="溯源码" min-width="150" />
              <el-table-column prop="statusName" label="状态" width="80" />
              <el-table-column prop="scanCount" label="扫码次数" width="90" />
              <el-table-column prop="createdAt" label="生成时间" min-width="150" />
            </el-table>
            <div v-if="detailCodes.length > 10" class="harvest-register__more">
              <el-button link type="primary" @click="showAllCodes = !showAllCodes">
                {{ showAllCodes ? '收起' : `查看全部（${detailCodes.length}）` }}
              </el-button>
            </div>
          </template>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.harvest-register__stats {
  margin-bottom: $space-md;
}

.harvest-register__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.harvest-register__section {
  margin-bottom: $space-md;
}

.harvest-register__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-sm;
}

.harvest-register__title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.harvest-register__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.harvest-register__trace-line {
  margin: 0 0 $space-md;
  font-size: $font-size-sm;
  color: $text-primary;
}

.harvest-register__trace-tip {
  margin-left: $space-sm;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.harvest-register__detail-title {
  margin: $space-lg 0 $space-sm;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.harvest-register__report {
  margin-bottom: $space-md;
  padding: $space-sm;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.harvest-register__report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-xs;
}

.harvest-register__report-no {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.harvest-register__report-meta {
  margin-bottom: $space-xs;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.harvest-register__more {
  margin-top: $space-xs;
  text-align: center;
}
</style>
