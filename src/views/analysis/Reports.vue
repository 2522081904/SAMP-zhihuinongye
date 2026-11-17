<script setup>
/**
 * P011 报表中心
 * 数据来源：A22 报表列表（GET /reports）、报表详情（GET /reports/{id}）、生成（POST /reports）。
 * 数据缺口说明：
 * - A22 的 type 是报表主题（产量/投入品/告警/溯源/产销），没有日报/周报/月报字段，
 *   页面按 period 字符串（YYYY-MM / a~b / 单日 / 季度）推导周期类型；
 * - A22 不返回 fileSize，文件大小为按 id 稳定推导的占位值；
 * - A22 不返回状态流转与地块覆盖范围，「生成中」用前端覆盖态模拟 2 秒，
 *   地块筛选仅对本轮页面生成、带本地地块映射的报表生效。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { createReport, fetchPlots, fetchReportDetail, fetchReports } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'AnalysisReportsPage' })

// 一天毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

// 生成中的模拟时长（毫秒）
const GENERATING_MS = 2000

// A22 支持的报表主题
const TYPE_OPTIONS = [
  { label: '产量分析', value: 'YIELD' },
  { label: '投入品分析', value: 'INPUT' },
  { label: '告警分析', value: 'ALARM' },
  { label: '溯源分析', value: 'TRACE' },
  { label: '产销分析', value: 'TRADE' }
]

// 周期类型（页面按 period 推导，生成时反向写入 period）
const CYCLE_OPTIONS = [
  { label: '日报', value: 'DAILY' },
  { label: '周报', value: 'WEEKLY' },
  { label: '月报', value: 'MONTHLY' }
]

// 报表格筛选的周期选项
const CYCLE_FILTER_OPTIONS = [
  { label: '全部类型', value: '' },
  ...CYCLE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  { label: '季报', value: 'QUARTER' }
]

// 生成报表可选的统计指标（A22 未接收该参数，仅作为生成表单的业务配置）
const METRIC_OPTIONS = ['温度', '湿度', '光照', 'CO₂', '告警', '农事']

// 报表状态展示映射（AgriStatusTag 内置映射不含报表状态，必须显式传入）
const STATUS_MAP = {
  READY: { text: '已完成', type: 'success' },
  GENERATING: { text: '生成中', type: 'warning' },
  FAILED: { text: '失败', type: 'danger' }
}

// 摘要指标中文名映射
const SUMMARY_LABELS = {
  totalYieldKg: '总产量（kg）',
  batchCount: '采收批次',
  qualifiedRate: '合格率（%）',
  avgUnitPrice: '平均单价（元/kg）',
  total: '告警总数',
  pendingCount: '待处理',
  criticalCount: '严重告警',
  resolvedRate: '处置率（%）',
  totalCodes: '溯源码总数',
  printedCount: '已打印',
  totalScan: '总扫码次数',
  voidCount: '作废码数',
  orderCount: '订单数',
  totalAmount: '订单总额（元）',
  paidAmount: '已付金额（元）',
  avgOrderAmount: '客单价（元）',
  totalValue: '投入品总额（元）',
  pesticideLogCount: '用药记录数',
  lowStockCount: '库存预警数',
  avgSafeInterval: '平均安全间隔期（天）'
}

const loading = ref(false)
const error = ref(false)
const rows = ref([])
const plotOptions = ref([])

// 查询条件与已生效条件分离，点「查询」才生效
const filters = reactive({ periodType: '', dateRange: [], plotId: '' })
const applied = ref({ periodType: '', dateRange: [], plotId: '' })

const page = ref(1)
const size = ref(10)

// 「生成中」「失败」的本地覆盖态
const generatingIds = ref([])
const failedIds = ref([])
// 本轮生成报表的地块覆盖（A22 无该字段）
const localPlotIds = ref({})
// 最近一次下载的文件名，便于页面反馈与验证
const lastDownload = ref('')

const timers = new Set()

// 生成报表弹窗
const dialogVisible = ref(false)
const submitting = ref(false)
const genForm = reactive({
  type: 'YIELD',
  cycle: 'MONTHLY',
  dateRange: [],
  plotIds: [],
  metrics: ['温度', '湿度'],
  format: 'PDF'
})

// 预览抽屉
const drawerVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)

const searchFields = computed(() => [
  {
    prop: 'periodType',
    label: '报表类型',
    type: 'select',
    options: CYCLE_FILTER_OPTIONS,
    placeholder: '全部类型'
  },
  { prop: 'dateRange', label: '时间范围', type: 'daterange' },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    options: plotOptions.value,
    placeholder: '全部地块'
  }
])

const columns = [
  { prop: 'reportNo', label: '报表编号', width: 132 },
  { prop: 'name', label: '报表名称', minWidth: 176 },
  { prop: 'cycle', label: '类型', width: 76, slot: 'cycle' },
  { prop: 'period', label: '覆盖周期', width: 156 },
  { prop: 'createdAt', label: '生成时间', width: 152 },
  { prop: 'status', label: '状态', width: 86, slot: 'status' },
  { prop: 'fileSize', label: '文件大小', width: 104, slot: 'fileSize' },
  { prop: 'actions', label: '操作', width: 168, slot: 'actions', fixed: 'right' }
]

/** 时间串转毫秒（兼容 Safari 连字符日期） */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/**
 * 由 period 推导周期类型。
 * '2026-11' → 月报；'2026-11-10~2026-11-16' → 周报；单日 → 日报；'2026Q4' → 季报。
 * @param {string} period 覆盖周期
 * @returns {{code: string, name: string}} 周期类型
 */
function cycleOf(period) {
  const text = String(period || '')
  if (/Q[1-4]$/i.test(text)) {
    return { code: 'QUARTER', name: '季报' }
  }
  if (text.includes('~')) {
    const [start, end] = text.split('~')
    const days = Math.round((toTimestamp(end) - toTimestamp(start)) / DAY_MS) + 1
    if (days <= 1) {
      return { code: 'DAILY', name: '日报' }
    }
    return days <= 7 ? { code: 'WEEKLY', name: '周报' } : { code: 'MONTHLY', name: '月报' }
  }
  return text.length === 7 ? { code: 'MONTHLY', name: '月报' } : { code: 'DAILY', name: '日报' }
}

/**
 * 文件大小占位值：A22 不返回文件大小，按 id 稳定推导，避免每次渲染跳动。
 * @param {Object} report 报表
 * @returns {string} 形如 '238 KB'
 */
function fileSizeOf(report) {
  const seed = String(report.id || report.reportNo || '')
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return `${(seed % 241) + 120} KB`
}

/**
 * 当前状态：本地覆盖态优先，其次接口状态。
 * @param {Object} report 报表
 * @returns {string} 状态码
 */
function statusOf(report) {
  if (generatingIds.value.includes(report.id)) {
    return 'GENERATING'
  }
  if (failedIds.value.includes(report.id)) {
    return 'FAILED'
  }
  return report.status || 'READY'
}

/** 查询过滤后的报表 */
const filteredRows = computed(() => {
  const condition = applied.value
  return rows.value.filter((row) => {
    if (condition.periodType && cycleOf(row.period).code !== condition.periodType) {
      return false
    }
    if (Array.isArray(condition.dateRange) && condition.dateRange.length === 2) {
      const created = toTimestamp(row.createdAt)
      if (
        created < toTimestamp(condition.dateRange[0]) ||
        created > toTimestamp(condition.dateRange[1])
      ) {
        return false
      }
    }
    if (condition.plotId) {
      const plotIds = localPlotIds.value[row.id] || []
      if (!plotIds.includes(condition.plotId)) {
        return false
      }
    }
    return true
  })
})

const total = computed(() => filteredRows.value.length)

/** 当前页数据（前端分页：A22 已一次取回全部报表） */
const pagedRows = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredRows.value.slice(start, start + size.value)
})

const emptyText = computed(() =>
  applied.value.plotId
    ? '没有匹配的报表：A22 不返回报表的地块覆盖范围，地块筛选仅对本轮生成的报表生效，可重置条件后重试'
    : '暂无符合条件的报表，可调整筛选条件或点击「生成报表」创建'
)

// 预览抽屉里的趋势折线
const detailTrendOption = computed(() => {
  const trend = detail.value?.charts?.trend || []
  return {
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: trend.map((item) => item.label),
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed' } } },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 5,
        areaStyle: { opacity: 0.12, color: '#2e7d58' },
        itemStyle: { color: '#2e7d58' },
        data: trend.map((item) => item.value)
      }
    ]
  }
})

// 预览抽屉里的分布饼图
const detailPieOption = computed(() => {
  const distribution = detail.value?.charts?.distribution || []
  return {
    tooltip: { trigger: 'item', formatter: '{b}：{c}（{d}%）' },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 8 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '64%'],
        center: ['50%', '42%'],
        label: { fontSize: 11, formatter: '{b} {c}' },
        data: distribution
      }
    ]
  }
})

// 摘要指标表
const summaryEntries = computed(() =>
  Object.entries(detail.value?.summary || {}).map(([key, value]) => ({
    label: SUMMARY_LABELS[key] || key,
    value: typeof value === 'number' ? String(value) : String(value ?? '-')
  }))
)

/** 载入报表列表 */
async function loadRows() {
  loading.value = true
  error.value = false
  try {
    const data = await fetchReports({ page: 1, size: 100 })
    rows.value = data?.list || []
  } catch (err) {
    error.value = err?.code !== 40401
  } finally {
    loading.value = false
  }
}

/** 载入地块下拉（A10） */
async function loadPlots() {
  try {
    const data = await fetchPlots({ page: 1, size: 50 })
    plotOptions.value = (data?.list || []).map((plot) => ({ label: plot.name, value: plot.id }))
  } catch {
    plotOptions.value = []
  }
}

/** 应用查询条件 */
function handleSearch() {
  applied.value = { ...filters }
  page.value = 1
}

/** 重置查询条件（AgriSearchBar 已把字段清空并抛 update:modelValue） */
function handleReset() {
  applied.value = { periodType: '', dateRange: [], plotId: '' }
  page.value = 1
}

/** 分页事件：AgriTable 抛的是 { page, size } 对象 */
function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

/** 打开生成报表弹窗 */
function openGenerate() {
  genForm.type = 'YIELD'
  genForm.cycle = 'MONTHLY'
  // 默认覆盖区间取最近一条报表的生成时间所在月（基准时间来自接口，不取本地时钟）
  const anchor = String(rows.value[0]?.createdAt || '').slice(0, 10)
  genForm.dateRange = anchor ? [`${anchor.slice(0, 7)}-01`, anchor] : []
  // 默认全选地块，避免每次生成都要重复勾选
  genForm.plotIds = plotOptions.value.map((item) => item.value)
  genForm.metrics = ['温度', '湿度']
  genForm.format = 'PDF'
  dialogVisible.value = true
}

/**
 * 按周期与时间范围生成 period 字符串。
 * @returns {string} period，非法时返回空串
 */
function buildPeriod() {
  const range = genForm.dateRange
  if (!Array.isArray(range) || range.length !== 2) {
    return ''
  }
  const start = String(range[0]).slice(0, 10)
  if (genForm.cycle === 'DAILY') {
    return start
  }
  if (genForm.cycle === 'WEEKLY') {
    return `${start}~${String(range[1]).slice(0, 10)}`
  }
  return start.slice(0, 7)
}

/** 状态在 2 秒后转为已完成 */
function scheduleReady(id) {
  const timer = setTimeout(() => {
    generatingIds.value = generatingIds.value.filter((item) => item !== id)
    timers.delete(timer)
  }, GENERATING_MS)
  timers.add(timer)
}

/** 提交生成报表 */
async function submitGenerate() {
  const period = buildPeriod()
  if (!period) {
    ElMessage.warning('请先选择报表覆盖的时间范围')
    return
  }
  if (!genForm.plotIds.length) {
    ElMessage.warning('请至少选择一个地块')
    return
  }
  submitting.value = true
  try {
    const typeName = TYPE_OPTIONS.find((item) => item.value === genForm.type)?.label || '报表'
    const cycleName = CYCLE_OPTIONS.find((item) => item.value === genForm.cycle)?.label || '报表'
    const created = await createReport({
      type: genForm.type,
      name: `${typeName}·${cycleName}`,
      period
    })
    if (!created?.id) {
      throw new Error('报表创建失败')
    }
    // 记录本轮生成报表的地块覆盖，供地块筛选使用
    localPlotIds.value = { ...localPlotIds.value, [created.id]: [...genForm.plotIds] }
    generatingIds.value = [...generatingIds.value, created.id]
    dialogVisible.value = false
    page.value = 1
    await loadRows()
    scheduleReady(created.id)
    ElMessage.success('报表已提交生成，2 秒后自动转为已完成')
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error(`报表生成失败：${err?.message || '请稍后重试'}`)
    }
  } finally {
    submitting.value = false
  }
}

/** 重新生成：覆盖态回到生成中，2 秒后恢复 */
function regenerate(row) {
  generatingIds.value = [...new Set([...generatingIds.value, row.id])]
  failedIds.value = failedIds.value.filter((item) => item !== row.id)
  scheduleReady(row.id)
  ElMessage.success(`已重新提交 ${row.reportNo}`)
}

/** 打开预览抽屉并拉取详情 */
async function openPreview(row) {
  drawerVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await fetchReportDetail(row.id)
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('报表详情加载失败')
    }
  } finally {
    detailLoading.value = false
  }
}

/**
 * 组装下载用的 CSV 内容。
 * @param {Object} report 报表
 * @returns {string} CSV 文本
 */
function buildCsv(report) {
  const header = [
    '报表编号',
    '报表名称',
    '报表主题',
    '类型',
    '覆盖周期',
    '生成时间',
    '状态',
    '文件大小'
  ]
  const line = [
    report.reportNo,
    report.name,
    report.typeName || report.type,
    cycleOf(report.period).name,
    report.period,
    report.createdAt,
    STATUS_MAP[statusOf(report)]?.text || statusOf(report),
    fileSizeOf(report)
  ]
  const escape = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`
  return [header, line].map((cells) => cells.map(escape).join(',')).join('\r\n')
}

/**
 * 下载报表：前端生成 CSV 文件（mock 无文件服务），文件名 报表编号_名称.csv。
 * @param {Object} report 报表
 */
function download(row) {
  const blob = new Blob([`\ufeff${buildCsv(row)}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = `${row.reportNo}_${row.name}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  lastDownload.value = `${row.reportNo}_${row.name}.csv`
  ElMessage.success('报表文件已开始下载')
}

onMounted(async () => {
  await Promise.all([loadRows(), loadPlots()])
})

onBeforeUnmount(() => {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
})
</script>

<template>
  <div class="page-container reports-page">
    <AgriPageHeader
      page-id="P011"
      title="报表中心"
      description="按周期生成、预览与下载生产报表，覆盖产量、投入品、告警、溯源与产销五类主题。"
    >
      <template #extra>
        <span class="reports-page__count">共 {{ total }} 份报表</span>
        <el-button type="primary" @click="openGenerate">生成报表</el-button>
      </template>
    </AgriPageHeader>

    <div v-if="error" class="reports-page__error" @click="loadRows">报表数据加载失败，点击重试</div>

    <div class="agri-card reports-page__query">
      <AgriSearchBar
        v-model="filters"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div v-if="lastDownload" class="reports-page__download-tip">最近下载：{{ lastDownload }}</div>

    <div class="agri-card reports-page__table">
      <AgriTable
        :columns="columns"
        :data="pagedRows"
        :loading="loading"
        :total="total"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #cycle="{ row }">
          <el-tag size="small" effect="plain">{{ cycleOf(row.period).name }}</el-tag>
        </template>
        <template #status="{ row }">
          <AgriStatusTag :status="statusOf(row)" :map="STATUS_MAP" />
        </template>
        <template #fileSize="{ row }">{{ fileSizeOf(row) }}</template>
        <template #actions="{ row }">
          <el-button link type="primary" @click="openPreview(row)">预览</el-button>
          <el-button link type="primary" @click="download(row)">下载</el-button>
          <el-button link type="warning" @click="regenerate(row)">重新生成</el-button>
        </template>
      </AgriTable>
    </div>

    <el-dialog v-model="dialogVisible" title="生成报表" width="620px">
      <el-form label-width="96px">
        <el-form-item label="报表主题">
          <el-select v-model="genForm.type" class="reports-page__full">
            <el-option
              v-for="item in TYPE_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="报表周期">
          <el-radio-group v-model="genForm.cycle">
            <el-radio v-for="item in CYCLE_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="genForm.dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            range-separator="至"
            class="reports-page__full"
          />
        </el-form-item>
        <el-form-item label="地块">
          <el-select
            v-model="genForm.plotIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="可多选"
            class="reports-page__full"
          >
            <el-option
              v-for="item in plotOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="统计指标">
          <el-checkbox-group v-model="genForm.metrics">
            <el-checkbox v-for="item in METRIC_OPTIONS" :key="item" :value="item">
              {{ item }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="文件格式">
          <el-radio-group v-model="genForm.format">
            <el-radio value="PDF">PDF</el-radio>
            <el-radio value="EXCEL">Excel</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="报表生成后状态先显示「生成中」，2 秒后由前端定时器转为「已完成」；下载为前端生成的 CSV 文件。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitGenerate">提交生成</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="drawerVisible" title="报表预览" size="560px">
      <div v-loading="detailLoading" class="reports-page__preview">
        <template v-if="detail">
          <h4 class="reports-page__preview-title">{{ detail.name }}</h4>
          <p class="reports-page__preview-meta">
            {{ detail.reportNo }} · {{ detail.typeName }} · {{ cycleOf(detail.period).name }} ·
            {{ detail.period }}
          </p>
          <p class="reports-page__preview-text">
            本报表覆盖周期 {{ detail.period }}，包含 {{ summaryEntries.length }} 项核心指标。
            数据取自环境监测、告警与生产记录口径，可用于月度经营复盘与上级报送。
          </p>
          <div class="reports-page__preview-charts">
            <AgriChart :option="detailTrendOption" height="180px" title="近 7 日趋势" />
            <AgriChart :option="detailPieOption" height="180px" title="构成分布" />
          </div>
          <el-table :data="summaryEntries" size="small" border class="reports-page__summary">
            <el-table-column prop="label" label="指标" min-width="180" />
            <el-table-column prop="value" label="数值" width="160" align="right" />
          </el-table>
          <p class="reports-page__preview-note">
            生成时间：{{ detail.generatedAt || detail.createdAt }}；生成人：{{
              detail.createdBy || '-'
            }}
          </p>
        </template>
        <el-empty v-else-if="!detailLoading" description="暂无报表详情" />
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.reports-page__count {
  margin-right: 8px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.reports-page__query {
  margin-bottom: 16px;
}

.reports-page__download-tip {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: $font-size-xs;
  color: #1f6b4d;
  background: rgba(46, 125, 88, 0.1);
  border-radius: $radius-sm;
}

.reports-page__table {
  margin-bottom: 16px;
}

.reports-page__full {
  width: 100%;
}

.reports-page__preview {
  min-height: 200px;
}

.reports-page__preview-title {
  margin: 0 0 6px;
  font-size: $font-size-md;
  color: $text-primary;
}

.reports-page__preview-meta {
  margin: 0 0 10px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.reports-page__preview-text {
  margin: 0 0 12px;
  font-size: $font-size-sm;
  line-height: 1.8;
  color: $text-primary;
}

.reports-page__preview-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.reports-page__summary {
  margin-top: 12px;
}

.reports-page__preview-note {
  margin: 12px 0 0;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.reports-page__error {
  margin-bottom: 16px;
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}
</style>
