<script setup>
/**
 * P023 检测报告与送检管理
 * 数据来源：A18 检测报告（GET /trace/inspections、GET /trace/inspections/{id}）、
 *           A15 采收批次（GET /harvest/batches，新建送检时选批次）。
 * 数据缺口与限制：
 * - 没有「送检任务」接口：任务保存在 localStorage（agri-lab-tasks-v1），只在本机可见，
 *   换浏览器或清缓存后丢失；
 * - 没有「报告文件」下载接口：报告下载由前端拼 text/plain Blob 生成，仅作演示；
 * - 没有「上传检测报告」接口：登记结果生成的报告写入 localStorage（agri-lab-reports-v1），
 *   与 A18 报告合并展示；后续接入真实接口时替换为 A18 的 createInspection；
 * - A18 种子只有 12 条报告，落在采收批次前 12 个上，其余 6 个批次没有报告，因此报告页只展示有报告的行；
 * - A18 的 from/to 过滤口径是「送检时间」，与页面「报告日期」筛选不一致，且本地报告不在接口内，
 *   所以列表一次性拉全量（size=100）后再在前端统一过滤，保证两个数据来源同一口径；
 * - 「检测中」状态本轮没有流转接口，仅作为枚举保留：新建任务固定「待送检」，登记结果后「已出报告」；
 * - 「本月送检」按本月有送检记录（报告或任务）的批次去重计数，避免同一批次被报告与任务重复统计。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchHarvestBatches, fetchInspectionDetail, fetchInspections } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'TraceLabPage' })

// 业务时间：mock 世界固定「现在」，页面所有日期默认值、月份口径都基于它
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_TIME_TEXT = BUSINESS_NOW_TEXT.slice(11)
const BUSINESS_TODAY = BUSINESS_NOW_TEXT.slice(0, 10)
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)

// 本地存储：送检任务与登记结果生成的报告（无后端接口，见文件头说明）
const TASK_STORAGE_KEY = 'agri-lab-tasks-v1'
const REPORT_STORAGE_KEY = 'agri-lab-reports-v1'

// 检测机构选项（新建送检）
const LAB_OPTIONS = ['省农科院检测中心', '市农产品质检站', '第三方华测检测']

// 送检可选的检测项：默认限量值/单位用于登记结果时预填
const ITEM_OPTIONS = [
  { name: '农药残留', unit: 'mg/kg', limit: 0.02 },
  { name: '重金属镉', unit: 'mg/kg', limit: 0.05 },
  { name: '重金属铅', unit: 'mg/kg', limit: 0.1 },
  { name: '亚硝酸盐', unit: 'mg/kg', limit: 4 },
  { name: '大肠菌群', unit: 'MPN/100g', limit: 30 },
  { name: '感官指标', unit: '分', limit: 100 }
]

// 报告结论：AgriStatusTag 内置「合格/不合格」能用，但这里显式传业务态 map，保证口径统一
const REPORT_STATUS_MAP = {
  PASS: { text: '合格', type: 'success' },
  FAIL: { text: '不合格', type: 'danger' }
}

// 送检任务状态：内置 PENDING 是「待处置」，必须覆盖
const TASK_STATUS_MAP = {
  PENDING: { text: '待送检', type: 'warning' },
  TESTING: { text: '检测中', type: 'primary' },
  REPORTED: { text: '已出报告', type: 'success' }
}

const userStore = useUserStore()

const activeTab = ref('reports')
const loading = ref(false)
const loadError = ref(false)

// A18 报告与 A15 批次
const inspections = ref([])
const batches = ref([])

// 本地送检任务与本地报告
const tasks = ref([])
const localReports = ref([])

// 报告筛选与分页
const reportQuery = ref({ keyword: '', conclusion: '', batchNo: '', dateRange: [] })
const reportPage = ref(1)
const reportSize = ref(10)

// 任务分页
const taskPage = ref(1)
const taskSize = ref(10)

// 报告抽屉
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const lastDownload = ref(null)

// 新建送检：第一步选检测项（自建多选弹窗），第二步填送检单（AgriFormDialog）
const itemPickVisible = ref(false)
const pickedItems = ref([])
const createVisible = ref(false)
const createSubmitting = ref(false)
const createDefaults = ref({})

// 登记结果弹窗
const resultVisible = ref(false)
const resultSubmitting = ref(false)
const resultTarget = ref(null)
const resultForm = reactive({ conclusion: 'PASS', reportDate: BUSINESS_TODAY, items: [] })

// 送检任务详情弹窗
const taskDetailVisible = ref(false)
const taskDetail = ref(null)

/** 当前用户名：A02 档案未就绪时兜底「管理员」 */
const currentUserName = computed(() => {
  const name = userStore.userName
  return name && !['未登录', '加载中…'].includes(name) ? name : '管理员'
})

/**
 * 读取本地存储的数组，解析失败或类型不符一律当空数组处理。
 * @param {string} key 存储键
 * @returns {Array} 数组数据
 */
function readStorage(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 写入本地存储：失败（隐私模式/超额）时提示，避免页面数据与预期不一致。
 * @param {string} key 存储键
 * @param {Array} value 数组数据
 * @returns {boolean} 是否写入成功
 */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    ElMessage.error('本地存储写入失败，本次数据仅保留在当前页面')
    return false
  }
}

/** 结论中文文案（本地报告也带 conclusionName，统一兜底） */
function conclusionOf(row) {
  return REPORT_STATUS_MAP[row?.conclusion]?.text || row?.conclusionName || '-'
}

/**
 * A18 报告 → 列表行：拆出送检日期与报告日期，统一 items 字段。
 * @param {Object} item A18 检测报告
 * @returns {Object} 列表行
 */
function fromInspection(item) {
  const items = item.inspectItems || []
  return {
    key: `a18-${item.id}`,
    id: item.id,
    source: 'a18',
    reportNo: item.reportNo,
    batchNo: item.batchNo,
    sampleName: item.sampleName || '',
    lab: item.lab || '-',
    inspector: item.inspector || '-',
    inspectedDate: String(item.inspectedAt || '').slice(0, 10),
    reportDate: String(item.createdAt || item.inspectedAt || '').slice(0, 10),
    conclusion: item.conclusion,
    conclusionName: item.conclusionName,
    items,
    itemCount: items.length
  }
}

/**
 * 本地报告 → 列表行：字段与 A18 行保持一致，便于合并筛选。
 * @param {Object} item 本地报告
 * @returns {Object} 列表行
 */
function fromLocalReport(item) {
  const items = item.inspectItems || item.items || []
  return {
    key: `local-${item.id}`,
    id: item.id,
    source: 'local',
    reportNo: item.reportNo,
    batchNo: item.batchNo,
    sampleName: item.sampleName || '',
    lab: item.lab || '-',
    inspector: item.inspector || '-',
    inspectedDate: String(item.inspectedAt || '').slice(0, 10),
    reportDate: String(item.createdAt || item.reportDate || '').slice(0, 10),
    conclusion: item.conclusion,
    conclusionName: item.conclusionName,
    items,
    itemCount: items.length
  }
}

/** 报告行：A18 + 本地报告，按报告日期倒序（同日按报告编号倒序，保证排序稳定） */
const reportRows = computed(() => {
  const merged = [
    ...localReports.value.map((item) => fromLocalReport(item)),
    ...inspections.value.map((item) => fromInspection(item))
  ]
  return merged.sort((left, right) => {
    const byDate = String(right.reportDate).localeCompare(String(left.reportDate))
    return byDate !== 0 ? byDate : String(right.reportNo).localeCompare(String(left.reportNo))
  })
})

const reportSearchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '报告编号 / 批次号 / 机构',
    width: 240
  },
  {
    prop: 'conclusion',
    label: '结论',
    type: 'select',
    placeholder: '全部结论',
    options: [
      { label: '合格', value: 'PASS' },
      { label: '不合格', value: 'FAIL' }
    ],
    width: 140
  },
  { prop: 'batchNo', label: '批次号', type: 'input', placeholder: '如 HB-2026...', width: 200 },
  { prop: 'dateRange', label: '报告日期', type: 'daterange' }
])

// 列宽合计 965px，控制在 1060px 内，避免 1440 视口下横向截断
const reportColumns = [
  { prop: 'reportNo', label: '报告编号', width: 150 },
  { prop: 'batchNo', label: '批次号', width: 140 },
  { prop: 'lab', label: '检测机构', width: 175, showOverflowTooltip: true },
  { prop: 'inspectedDate', label: '送检日期', width: 104 },
  { prop: 'reportDate', label: '报告日期', width: 104 },
  { prop: 'conclusion', label: '结论', width: 84, slot: 'conclusion' },
  { prop: 'itemCount', label: '检测项数', width: 88, align: 'center' },
  { prop: 'action', label: '操作', width: 120, slot: 'action', align: 'center' }
]

// 列宽合计 970px，同样控制在 1060px 内
const taskColumns = [
  { prop: 'taskNo', label: '任务号', width: 140 },
  { prop: 'batchNo', label: '批次', width: 140 },
  { prop: 'items', label: '检测项', width: 230, slot: 'items', showOverflowTooltip: true },
  { prop: 'sender', label: '送检人', width: 90 },
  { prop: 'sendDate', label: '送检日期', width: 104 },
  { prop: 'status', label: '状态', width: 96, slot: 'status' },
  { prop: 'action', label: '操作', width: 170, slot: 'action', align: 'center' }
]

// 抽屉里的检测项表：5 列合计 580px，抽屉宽 560px 内部自适应
const itemColumns = [
  { prop: 'name', label: '检测项', minWidth: 110 },
  { prop: 'value', label: '检测值', width: 90, align: 'right' },
  { prop: 'limit', label: '限量值', width: 90, align: 'right' },
  { prop: 'unit', label: '单位', width: 100 },
  { prop: 'result', label: '单项判定', width: 90, slot: 'result', align: 'center' }
]

/** 报告筛选：关键词覆盖报告编号/批次号/机构，日期按「报告日期」比 yyyy-MM-dd 字符串 */
const filteredReports = computed(() => {
  const keyword = reportQuery.value.keyword.trim().toLowerCase()
  const { conclusion, batchNo } = reportQuery.value
  const batchKeyword = String(batchNo || '')
    .trim()
    .toLowerCase()
  const from = reportQuery.value.dateRange?.[0]?.slice(0, 10) || ''
  const to = reportQuery.value.dateRange?.[1]?.slice(0, 10) || ''
  return reportRows.value.filter((row) => {
    const matchKeyword =
      !keyword ||
      [row.reportNo, row.batchNo, row.lab].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchConclusion = !conclusion || row.conclusion === conclusion
    const matchBatch =
      !batchKeyword ||
      String(row.batchNo || '')
        .toLowerCase()
        .includes(batchKeyword)
    const matchDate = (!from || row.reportDate >= from) && (!to || row.reportDate <= to)
    return matchKeyword && matchConclusion && matchBatch && matchDate
  })
})

/** 列表抬头的合格/不合格数量：跟随筛选结果，避免「共 0 份但仍显示合格 10 份」的矛盾 */
const filteredConclusionCount = computed(() => {
  const passed = filteredReports.value.filter((row) => row.conclusion === 'PASS').length
  return { passed, failed: filteredReports.value.length - passed }
})

const pagedReports = computed(() => {
  const start = (reportPage.value - 1) * reportSize.value
  return filteredReports.value.slice(start, start + reportSize.value)
})

const pagedTasks = computed(() => {
  const start = (taskPage.value - 1) * taskSize.value
  return tasks.value.slice(start, start + taskSize.value)
})

/** 4 张卡片：报告总数 / 合格率 / 待出报告 / 本月送检（见文件头口径说明） */
const stats = computed(() => {
  const reports = reportRows.value
  const total = reports.length
  const passed = reports.filter((row) => row.conclusion === 'PASS').length
  const rate = total ? Number(((passed / total) * 100).toFixed(1)) : 0
  const pending = tasks.value.filter((task) => task.status !== 'REPORTED').length
  const monthBatches = new Set()
  reports.forEach((row) => {
    if (String(row.inspectedDate).startsWith(BUSINESS_MONTH)) {
      monthBatches.add(row.batchNo)
    }
  })
  tasks.value.forEach((task) => {
    if (String(task.sendDate).startsWith(BUSINESS_MONTH)) {
      monthBatches.add(task.batchNo)
    }
  })
  return { total, passed, rate, pending, monthCount: monthBatches.size }
})

const statCards = computed(() => [
  { label: '检测报告总数', value: stats.value.total, unit: '份', icon: 'Document', tone: 'brand' },
  {
    label: '合格率',
    value: stats.value.rate,
    unit: '%',
    precision: 1,
    icon: 'CircleCheck',
    tone: 'ok'
  },
  { label: '待出报告', value: stats.value.pending, unit: '条', icon: 'Clock', tone: 'warn' },
  { label: '本月送检', value: stats.value.monthCount, unit: '批', icon: 'Promotion', tone: 'brand' }
])

/** 报告空态：有筛选条件时说明覆盖范围，避免误以为数据缺失 */
const reportEmptyText = computed(() => {
  const hasFilter =
    reportQuery.value.keyword ||
    reportQuery.value.conclusion ||
    reportQuery.value.batchNo ||
    reportQuery.value.dateRange?.length
  if (hasFilter) {
    return '暂无匹配的检测报告：A18 只有前 12 个批次有检测报告，请调整关键词、结论、批次号或报告日期后再试'
  }
  return '暂无检测报告：可在「送检任务」中新建送检并登记结果'
})

/** 可送检批次：A15 中没有报告、也没有送检任务的批次 */
const availableBatches = computed(() => {
  const used = new Set()
  reportRows.value.forEach((row) => used.add(row.batchNo))
  tasks.value.forEach((task) => used.add(task.batchNo))
  return batches.value.filter((batch) => !used.has(batch.batchNo))
})

const availableBatchOptions = computed(() =>
  availableBatches.value.map((batch) => ({
    label: `${batch.batchNo}（${batch.crop} ${batch.harvestDate}）`,
    value: batch.batchNo
  }))
)

/** 新建送检表单：检测项只读回显，真正选择在上一步的多选弹窗里完成 */
const createFields = computed(() => [
  {
    prop: 'batchNo',
    label: '批次',
    type: 'select',
    required: true,
    options: availableBatchOptions.value,
    span: 2,
    tip: '只列出 A15 中没有检测报告、也没有送检任务的批次'
  },
  { prop: 'lab', label: '检测机构', type: 'select', required: true, options: LAB_OPTIONS },
  { prop: 'itemsText', label: '检测项', type: 'input', disabled: true },
  { prop: 'sendDate', label: '送检日期', type: 'date', required: true },
  { prop: 'sender', label: '送检人', type: 'input', required: true },
  { prop: 'remark', label: '备注', type: 'textarea', span: 2 }
])

const createRules = {
  batchNo: [{ required: true, message: '请选择送检批次', trigger: 'change' }],
  lab: [{ required: true, message: '请选择检测机构', trigger: 'change' }],
  sendDate: [{ required: true, message: '请选择送检日期', trigger: 'change' }],
  sender: [{ required: true, message: '请填写送检人', trigger: 'blur' }]
}

/** 检测项摘要：超过 3 项显示「+N」 */
function itemSummary(names) {
  const list = names || []
  if (!list.length) {
    return '-'
  }
  if (list.length <= 3) {
    return list.join('、')
  }
  return `${list.slice(0, 3).join('、')} +${list.length - 3}`
}

/**
 * 载入 A18 报告与 A15 批次；报告一次拉全量，筛选在前端完成（原因见文件头）。
 * @returns {Promise<void>}
 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [reportData, batchData] = await Promise.all([
      fetchInspections({ page: 1, size: 100 }),
      fetchHarvestBatches({ page: 1, size: 100 })
    ])
    inspections.value = reportData?.list || []
    batches.value = batchData?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/** 从本地存储恢复任务与报告（无后端接口，见文件头） */
function loadLocal() {
  tasks.value = readStorage(TASK_STORAGE_KEY)
  localReports.value = readStorage(REPORT_STORAGE_KEY)
}

function handleReportSearch() {
  reportPage.value = 1
}

function handleReportReset() {
  reportQuery.value = { keyword: '', conclusion: '', batchNo: '', dateRange: [] }
  reportPage.value = 1
}

function handleReportPageChange(payload) {
  reportPage.value = payload.page
  reportSize.value = payload.size
}

function handleTaskPageChange(payload) {
  taskPage.value = payload.page
  taskSize.value = payload.size
}

/**
 * 打开报告抽屉：A18 报告走详情接口，本地报告直接用本地数据。
 * 40401 按约定静默，抽屉内展示空态。
 * @param {Object} row 报告行
 * @returns {Promise<void>}
 */
async function openReport(row) {
  detailVisible.value = true
  detail.value = null
  if (row.source === 'local') {
    detail.value = row
    return
  }
  detailLoading.value = true
  try {
    const data = await fetchInspectionDetail(row.id)
    detail.value = data ? fromInspection(data) : null
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('报告详情加载失败，请稍后重试')
    }
  } finally {
    detailLoading.value = false
  }
}

/** 按报告编号打开抽屉（任务详情里「查看报告」用） */
function openReportByNo(reportNo) {
  const row = reportRows.value.find((item) => item.reportNo === reportNo)
  if (!row) {
    ElMessage.warning('未找到对应的检测报告')
    return
  }
  taskDetailVisible.value = false
  openReport(row)
}

/** 抽屉结论段文字：机构、批次、项数、综合判定拼成一段话 */
const detailConclusionText = computed(() => {
  const row = detail.value
  if (!row) {
    return ''
  }
  const items = row.items || []
  const failed = items.filter((item) => item.result === '不合格').length
  return (
    `本报告由${row.lab}出具，送检样品为${row.sampleName || row.batchNo}，` +
    `送检日期 ${row.inspectedDate}，报告日期 ${row.reportDate}。` +
    `共检测 ${items.length} 项，合格 ${items.length - failed} 项` +
    `${failed ? `，不合格 ${failed} 项` : ''}，综合判定：${conclusionOf(row)}。` +
    '检测依据 GB 2763、GB 2762 执行，结果仅对来样负责。'
  )
})

/** 单项判定文案：检测值 ≤ 限量值即合格；未填完显示「-」 */
function itemResult(item) {
  if (item.value === null || item.value === '' || item.limit === null || item.limit === '') {
    return '-'
  }
  const value = Number(item.value)
  const limit = Number(item.limit)
  if (!Number.isFinite(value) || !Number.isFinite(limit)) {
    return '-'
  }
  return value <= limit ? '合格' : '不合格'
}

/** 单项判定的样式类：合格绿、不合格红 */
function judgeClass(item) {
  const result = itemResult(item)
  if (result === '合格') {
    return 'lab-report__judge is-pass'
  }
  if (result === '不合格') {
    return 'lab-report__judge is-fail'
  }
  return 'lab-report__judge'
}

/**
 * 拼报告纯文本：抬头 + 批次 + 制表符表格 + 结论，供 Blob 下载。
 * @param {Object} row 报告行
 * @returns {string} 制表符对齐的文本
 */
function buildReportText(row) {
  const items = row.items || []
  const failed = items.filter((item) => item.result === '不合格').length
  const lines = [
    '农产品质量安全检测报告',
    '='.repeat(42),
    `报告编号：${row.reportNo}`,
    `批次号：${row.batchNo}`,
    `样品名称：${row.sampleName || '-'}`,
    `检测机构：${row.lab}`,
    `送检人：${row.inspector}`,
    `送检日期：${row.inspectedDate}`,
    `报告日期：${row.reportDate}`,
    `检测结论：${conclusionOf(row)}`,
    '-'.repeat(42),
    ['检测项', '检测值', '限量值', '单位', '单项判定'].join('\t')
  ]
  items.forEach((item) => {
    lines.push([item.name, item.value, item.limit, item.unit, item.result].join('\t'))
  })
  lines.push('-'.repeat(42))
  lines.push(`共检测 ${items.length} 项，合格 ${items.length - failed} 项，不合格 ${failed} 项。`)
  lines.push(`综合判定：${conclusionOf(row)}。`)
  lines.push('说明：本文件由页面数据生成，仅用于演示，不具备检测机构签章效力。')
  return lines.join('\r\n')
}

/**
 * 触发浏览器下载：Blob + createObjectURL + a.download。
 * @param {Blob} blob 文件内容
 * @param {string} fileName 文件名
 */
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 下载单份报告：无后端文件接口，前端拼 text/plain Blob。
 * @param {Object} row 报告行
 */
function downloadReport(row) {
  const blob = new Blob([buildReportText(row)], { type: 'text/plain;charset=utf-8' })
  const fileName = `${row.reportNo}_检测报告.txt`
  saveBlob(blob, fileName)
  lastDownload.value = { fileName, size: blob.size }
  ElMessage.success(`已开始下载 ${fileName}（${blob.size} 字节）`)
}

/** CSV 单元格转义：双引号包裹并转义内部双引号 */
function escapeCsv(cell) {
  return `"${String(cell ?? '').replace(/"/g, '""')}"`
}

/** 导出当前筛选结果为 CSV（带 BOM，兼容 Excel/GBK 打开） */
function exportReports() {
  const rows = filteredReports.value
  if (!rows.length) {
    ElMessage.warning('当前筛选结果为空，没有可导出的检测报告')
    return
  }
  const header = ['报告编号', '批次号', '检测机构', '送检日期', '报告日期', '结论', '检测项数']
  const body = rows.map((row) => [
    row.reportNo,
    row.batchNo,
    row.lab,
    row.inspectedDate,
    row.reportDate,
    conclusionOf(row),
    row.itemCount
  ])
  const csv = [header, ...body].map((cells) => cells.map(escapeCsv).join(',')).join('\r\n')
  const fileName = `检测报告_${BUSINESS_MONTH}.csv`
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  saveBlob(blob, fileName)
  lastDownload.value = { fileName, size: blob.size }
  ElMessage.success(`已导出 ${rows.length} 条检测报告：${fileName}`)
}

/** 导出全部送检任务 CSV（同一套 BOM + 转义规则） */
function exportTasks() {
  if (!tasks.value.length) {
    ElMessage.warning('暂无送检任务可导出')
    return
  }
  const header = ['任务号', '批次号', '作物', '检测项', '送检人', '送检日期', '状态']
  const body = tasks.value.map((task) => [
    task.taskNo,
    task.batchNo,
    task.crop || '-',
    (task.items || []).join('、'),
    task.sender,
    task.sendDate,
    TASK_STATUS_MAP[task.status]?.text || task.statusName || '-'
  ])
  const csv = [header, ...body].map((cells) => cells.map(escapeCsv).join(',')).join('\r\n')
  const fileName = `送检任务_${BUSINESS_MONTH}.csv`
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  saveBlob(blob, fileName)
  ElMessage.success(`已导出 ${tasks.value.length} 条送检任务：${fileName}`)
}

/** 打开检测项多选弹窗（AgriFormDialog 不支持多选，这里自建 el-dialog） */
function openItemPicker() {
  if (!availableBatches.value.length) {
    ElMessage.warning('没有可送检的批次：剩余批次均已有检测报告或已送检')
    return
  }
  pickedItems.value = []
  itemPickVisible.value = true
}

function selectAllItems() {
  pickedItems.value = ITEM_OPTIONS.map((option) => option.name)
}

function clearItems() {
  pickedItems.value = []
}

/** 检测项确认：至少 1 项，通过后进入送检单表单 */
function confirmItems() {
  if (!pickedItems.value.length) {
    ElMessage.warning('请至少选择 1 个检测项')
    return
  }
  itemPickVisible.value = false
  createDefaults.value = {
    batchNo: availableBatches.value[0]?.batchNo || '',
    lab: LAB_OPTIONS[0],
    itemsText: pickedItems.value.join('、'),
    sendDate: BUSINESS_TODAY,
    sender: currentUserName.value,
    remark: ''
  }
  createVisible.value = true
}

/** 生成任务号：SJ-2026-NNN，序号取现有任务最大值 +1 */
function nextTaskNo() {
  const max = tasks.value.reduce((current, task) => {
    const match = /(\d+)$/.exec(task.taskNo || '')
    return Math.max(current, match ? Number(match[1]) : 0)
  }, 0)
  return `SJ-2026-${String(max + 1).padStart(3, '0')}`
}

/**
 * 提交送检任务：写入 localStorage，新任务插首位，状态「待送检」。
 * 4 张卡片由 reportRows / tasks 计算，写入后自动刷新（无后端接口，不重新拉取）。
 * @param {Object} payload AgriFormDialog 表单值
 */
function submitCreate(payload) {
  if (createSubmitting.value) {
    return
  }
  const batch = batches.value.find((item) => item.batchNo === payload.batchNo)
  if (!batch) {
    ElMessage.warning('请选择有效的送检批次')
    return
  }
  if (!pickedItems.value.length) {
    ElMessage.warning('请至少选择 1 个检测项')
    return
  }
  createSubmitting.value = true
  const taskNo = nextTaskNo()
  const task = {
    id: taskNo,
    taskNo,
    batchId: batch.id,
    batchNo: batch.batchNo,
    crop: batch.crop,
    plotName: batch.plotName,
    lab: payload.lab || LAB_OPTIONS[0],
    items: pickedItems.value.slice(),
    sender: String(payload.sender || '').trim() || currentUserName.value,
    sendDate: payload.sendDate || BUSINESS_TODAY,
    status: 'PENDING',
    statusName: TASK_STATUS_MAP.PENDING.text,
    remark: String(payload.remark || '').trim(),
    createdAt: BUSINESS_NOW_TEXT,
    reportNo: ''
  }
  tasks.value = [task, ...tasks.value]
  writeStorage(TASK_STORAGE_KEY, tasks.value)
  createSubmitting.value = false
  createVisible.value = false
  taskPage.value = 1
  ElMessage.success('送检任务已创建')
}

/** 打开登记结果：按任务已选检测项生成动态行，限量值/单位用默认值预填 */
function openResult(row) {
  if (row.status === 'REPORTED') {
    ElMessage.warning('该任务已出报告，无需重复登记')
    return
  }
  resultTarget.value = row
  resultForm.conclusion = 'PASS'
  resultForm.reportDate = BUSINESS_TODAY
  resultForm.items = (row.items || []).map((name) => {
    const option = ITEM_OPTIONS.find((item) => item.name === name) || ITEM_OPTIONS[0]
    return { name: option.name, value: null, limit: option.limit, unit: option.unit }
  })
  if (!resultForm.items.length) {
    resultForm.items = [
      {
        name: ITEM_OPTIONS[0].name,
        value: null,
        limit: ITEM_OPTIONS[0].limit,
        unit: ITEM_OPTIONS[0].unit
      }
    ]
  }
  resultVisible.value = true
}

/** 新增一行检测项录入 */
function addResultItem() {
  const option = ITEM_OPTIONS[0]
  resultForm.items.push({ name: option.name, value: null, limit: option.limit, unit: option.unit })
}

/** 删除一行检测项，至少保留 1 行 */
function removeResultItem(index) {
  if (resultForm.items.length <= 1) {
    ElMessage.warning('至少保留 1 个检测项')
    return
  }
  resultForm.items.splice(index, 1)
}

/** 切换检测项名称时，把限量值与单位重置为该项目的默认值 */
function handleItemNameChange(item) {
  const option = ITEM_OPTIONS.find((entry) => entry.name === item.name)
  if (option) {
    item.limit = option.limit
    item.unit = option.unit
  }
}

/** 超限项数量：用于「结论自动落为不合格」和必填校验 */
const failedItemCount = computed(
  () => resultForm.items.filter((item) => itemResult(item) === '不合格').length
)

// 任一检测项超限时结论自动落为不合格，避免「项不合格但结论合格」的矛盾数据
watch(failedItemCount, (count) => {
  if (count > 0) {
    resultForm.conclusion = 'FAIL'
  }
})

/** 生成报告编号：JC-2026-NNN，序号取 A18 + 本地报告最大值 +1 */
function nextReportNo() {
  const max = reportRows.value.reduce((current, row) => {
    const match = /(\d+)$/.exec(row.reportNo || '')
    return Math.max(current, match ? Number(match[1]) : 0)
  }, 0)
  return `JC-2026-${String(max + 1).padStart(3, '0')}`
}

/**
 * 提交登记结果：写 localStorage 报告 + 把任务状态改为「已出报告」，
 * 两个 Tab 与卡片都基于同一份本地数据，写入后自动刷新。
 */
function submitResult() {
  const task = resultTarget.value
  if (!task || resultSubmitting.value) {
    return
  }
  if (!resultForm.items.length) {
    ElMessage.warning('请至少录入 1 个检测项')
    return
  }
  const invalidIndex = resultForm.items.findIndex((item) => {
    const valueBlank =
      item.value === null || item.value === '' || !Number.isFinite(Number(item.value))
    const limitBlank =
      item.limit === null || item.limit === '' || !Number.isFinite(Number(item.limit))
    return !item.name || valueBlank || limitBlank
  })
  if (invalidIndex >= 0) {
    ElMessage.warning(`第 ${invalidIndex + 1} 行检测项未填写完整（名称 / 检测值 / 限量值）`)
    return
  }
  resultSubmitting.value = true
  const inspectItems = resultForm.items.map((item) => ({
    name: item.name,
    value: Number(item.value),
    limit: Number(item.limit),
    unit: String(item.unit || 'mg/kg'),
    result: Number(item.value) <= Number(item.limit) ? '合格' : '不合格'
  }))
  const hasFailed = inspectItems.some((item) => item.result === '不合格')
  // 结论以用户单选为准，但出现超限项时强制不合格（watch 已同步，这里再兜一层）
  const conclusion = hasFailed ? 'FAIL' : resultForm.conclusion
  const reportNo = nextReportNo()
  const batch = batches.value.find((item) => item.batchNo === task.batchNo)
  const report = {
    id: Date.parse(`${resultForm.reportDate} ${BUSINESS_TIME_TEXT}`) || 0,
    reportNo,
    batchId: batch?.id || null,
    batchNo: task.batchNo,
    sampleName: `${task.crop || '农产品'}（${task.batchNo}）`,
    sampleSource: task.plotName || '',
    inspectItems,
    conclusion,
    conclusionName: REPORT_STATUS_MAP[conclusion]?.text || conclusion,
    inspector: task.sender,
    lab: task.lab,
    inspectedAt: `${task.sendDate} 09:00:00`,
    createdAt: `${resultForm.reportDate} ${BUSINESS_TIME_TEXT}`,
    reportDate: resultForm.reportDate,
    source: 'local',
    remark: task.remark || ''
  }
  localReports.value = [report, ...localReports.value]
  writeStorage(REPORT_STORAGE_KEY, localReports.value)
  tasks.value = tasks.value.map((item) =>
    item.id === task.id
      ? {
          ...item,
          status: 'REPORTED',
          statusName: TASK_STATUS_MAP.REPORTED.text,
          reportNo,
          reportedAt: report.createdAt
        }
      : item
  )
  writeStorage(TASK_STORAGE_KEY, tasks.value)
  resultSubmitting.value = false
  resultVisible.value = false
  reportPage.value = 1
  ElMessage.success(`检测结果已登记，报告 ${reportNo} 已生成`)
}

/** 打开任务详情弹窗（任务比报告多机构、备注、检测项清单等信息） */
function openTaskDetail(row) {
  taskDetail.value = row
  taskDetailVisible.value = true
}

onMounted(async () => {
  loadLocal()
  await loadAll()
})
</script>

<template>
  <div class="page-container lab-report">
    <AgriPageHeader
      page-id="P023"
      title="检测报告与送检管理"
      description="登记送检任务、查看农残检测报告，报告与采收批次一一关联。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="lab-report__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :precision="card.precision || 0"
          :icon="card.icon"
          :tone="card.tone"
          :loading="loading"
        />
      </el-col>
    </el-row>
    <p class="lab-report__note text-secondary">
      说明：送检任务与登记生成的报告暂存浏览器本地（无送检任务接口），换设备不可见； A18 仅前 12
      个批次有检测报告，「本月送检」按本月有送检记录的批次去重计数。
    </p>

    <el-tabs v-model="activeTab" class="lab-report__tabs">
      <el-tab-pane label="检测报告" name="reports">
        <div class="agri-card lab-report__section">
          <AgriSearchBar
            v-model="reportQuery"
            :fields="reportSearchFields"
            :loading="loading"
            @search="handleReportSearch"
            @reset="handleReportReset"
          />
        </div>

        <div class="agri-card lab-report__section">
          <div class="lab-report__toolbar">
            <div>
              <h3 class="lab-report__title">检测报告</h3>
              <span class="text-secondary lab-report__sub">
                共 {{ filteredReports.length }} 份，合格
                {{ filteredConclusionCount.passed }} 份，不合格
                {{ filteredConclusionCount.failed }} 份
              </span>
            </div>
            <div class="lab-report__actions">
              <el-button :loading="loading" @click="exportReports">导出全部</el-button>
            </div>
          </div>
          <div v-if="loadError" class="lab-report__error" @click="loadAll">
            检测报告加载失败，点击重试
          </div>
          <AgriTable
            v-else
            :columns="reportColumns"
            :data="pagedReports"
            :loading="loading"
            :total="filteredReports.length"
            :page="reportPage"
            :size="reportSize"
            row-key="key"
            :empty-text="reportEmptyText"
            @page-change="handleReportPageChange"
            @size-change="handleReportPageChange"
          >
            <template #conclusion="{ row }">
              <AgriStatusTag :status="row.conclusion" :map="REPORT_STATUS_MAP" />
            </template>
            <template #itemCount="{ row }">{{ row.itemCount }} 项</template>
            <template #action="{ row }">
              <el-button link type="primary" @click.stop="openReport(row)">查看</el-button>
              <el-button link type="primary" @click.stop="downloadReport(row)">下载</el-button>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>

      <el-tab-pane label="送检任务" name="tasks">
        <div class="agri-card lab-report__section">
          <div class="lab-report__toolbar">
            <div>
              <h3 class="lab-report__title">送检任务</h3>
              <span class="text-secondary lab-report__sub">
                共 {{ tasks.length }} 条，待出报告 {{ stats.pending }} 条
              </span>
            </div>
            <div class="lab-report__actions">
              <el-button @click="exportTasks">导出 CSV</el-button>
              <el-button type="primary" @click="openItemPicker">新建送检</el-button>
            </div>
          </div>
          <AgriTable
            :columns="taskColumns"
            :data="pagedTasks"
            :loading="loading"
            :total="tasks.length"
            :page="taskPage"
            :size="taskSize"
            row-key="id"
            empty-text="暂无送检任务，可点击右上角「新建送检」发起检测"
            @page-change="handleTaskPageChange"
            @size-change="handleTaskPageChange"
          >
            <template #items="{ row }">{{ itemSummary(row.items) }}</template>
            <template #status="{ row }">
              <AgriStatusTag :status="row.status" :map="TASK_STATUS_MAP" />
            </template>
            <template #action="{ row }">
              <el-button
                link
                type="primary"
                :disabled="row.status === 'REPORTED'"
                @click.stop="openResult(row)"
              >
                登记结果
              </el-button>
              <el-button link type="primary" @click.stop="openTaskDetail(row)">查看</el-button>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 报告详情抽屉：报告头 + 结论 + 检测项 + 结论段 + 下载 -->
    <el-drawer v-model="detailVisible" title="检测报告详情" size="580px">
      <div v-loading="detailLoading" class="lab-report__drawer">
        <template v-if="detail">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="报告编号">{{ detail.reportNo }}</el-descriptions-item>
            <el-descriptions-item label="批次号">{{ detail.batchNo }}</el-descriptions-item>
            <el-descriptions-item label="检测机构">{{ detail.lab }}</el-descriptions-item>
            <el-descriptions-item label="送检人">{{ detail.inspector }}</el-descriptions-item>
            <el-descriptions-item label="送检日期">
              {{ detail.inspectedDate }}
            </el-descriptions-item>
            <el-descriptions-item label="报告日期">{{ detail.reportDate }}</el-descriptions-item>
          </el-descriptions>

          <div class="lab-report__conclusion">
            <span class="lab-report__conclusion-label">检测结论</span>
            <AgriStatusTag :status="detail.conclusion" :map="REPORT_STATUS_MAP" />
            <span class="lab-report__conclusion-text">
              {{ conclusionOf(detail) }} · 共 {{ detail.items.length }} 项
            </span>
          </div>

          <el-table :data="detail.items" size="small" border class="lab-report__items-table">
            <el-table-column
              v-for="column in itemColumns"
              :key="column.prop"
              :prop="column.prop"
              :label="column.label"
              :width="column.width"
              :min-width="column.minWidth"
              :align="column.align || 'left'"
              :header-align="column.align || 'left'"
            >
              <template #default="scope">
                <template v-if="column.slot === 'result'">
                  <AgriStatusTag :status="scope.row.result" :map="REPORT_STATUS_MAP" />
                </template>
                <template v-else>{{ scope.row[column.prop] }}</template>
              </template>
            </el-table-column>
          </el-table>

          <div class="lab-report__paragraph">
            <h4 class="lab-report__paragraph-title">结论说明</h4>
            <p class="lab-report__paragraph-text">{{ detailConclusionText }}</p>
          </div>

          <p v-if="lastDownload" class="lab-report__download-hint text-secondary">
            最近下载：{{ lastDownload.fileName }}（{{ lastDownload.size }} 字节）
          </p>
        </template>
        <AgriEmpty v-else-if="!detailLoading" description="报告不存在或已删除，请刷新列表后重试" />
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!detail" @click="detail && downloadReport(detail)">
          下载报告
        </el-button>
      </template>
    </el-drawer>

    <!-- 检测项多选：AgriFormDialog 不支持多选，这里用自建 el-dialog -->
    <el-dialog v-model="itemPickVisible" title="选择检测项" width="520px">
      <div class="lab-report__picker">
        <div class="lab-report__picker-head">
          <span class="text-secondary">至少选择 1 项，已选 {{ pickedItems.length }} 项</span>
          <div>
            <el-button link type="primary" @click="selectAllItems">全选</el-button>
            <el-button link type="primary" @click="clearItems">清空</el-button>
          </div>
        </div>
        <el-checkbox-group v-model="pickedItems" class="lab-report__picker-group">
          <el-checkbox
            v-for="option in ITEM_OPTIONS"
            :key="option.name"
            :value="option.name"
            class="lab-report__picker-item"
          >
            {{ option.name }}
            <span class="lab-report__picker-unit">限量 {{ option.limit }} {{ option.unit }}</span>
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button @click="itemPickVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmItems">下一步</el-button>
      </template>
    </el-dialog>

    <!-- 新建送检：送检单主体用 AgriFormDialog，检测项在上一步已选好并只读回显 -->
    <AgriFormDialog
      v-model="createVisible"
      title="新建送检任务"
      :fields="createFields"
      :rules="createRules"
      :default-values="createDefaults"
      :loading="createSubmitting"
      width="620px"
      submit-text="创建任务"
      @submit="submitCreate"
    />

    <!-- 登记结果：结论 + 报告日期 + 检测项动态行 -->
    <el-dialog v-model="resultVisible" title="登记检测结果" width="760px">
      <template v-if="resultTarget">
        <p class="lab-report__result-meta text-secondary">
          任务 {{ resultTarget.taskNo }} ｜ 批次 {{ resultTarget.batchNo }} ｜ 机构
          {{ resultTarget.lab }}
        </p>
        <el-form label-width="88px">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="检测结论" required>
                <el-radio-group v-model="resultForm.conclusion">
                  <el-radio value="PASS">合格</el-radio>
                  <el-radio value="FAIL">不合格</el-radio>
                </el-radio-group>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="报告日期" required>
                <el-date-picker
                  v-model="resultForm.reportDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="请选择报告日期"
                  class="lab-report__full"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <div class="lab-report__result-head">
          <h4 class="lab-report__sub-title">检测项录入</h4>
          <el-button link type="primary" @click="addResultItem">添加检测项</el-button>
        </div>
        <el-table :data="resultForm.items" size="small" border class="lab-report__result-table">
          <el-table-column label="检测项" width="180">
            <template #default="{ row }">
              <el-select v-model="row.name" size="small" @change="handleItemNameChange(row)">
                <el-option
                  v-for="option in ITEM_OPTIONS"
                  :key="option.name"
                  :label="option.name"
                  :value="option.name"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="检测值" width="130">
            <template #default="{ row }">
              <el-input-number
                v-model="row.value"
                :min="0"
                :precision="3"
                :controls="false"
                size="small"
                placeholder="检测值"
                class="lab-report__full"
              />
            </template>
          </el-table-column>
          <el-table-column label="限量值" width="130">
            <template #default="{ row }">
              <el-input-number
                v-model="row.limit"
                :min="0"
                :precision="3"
                :controls="false"
                size="small"
                placeholder="限量值"
                class="lab-report__full"
              />
            </template>
          </el-table-column>
          <el-table-column label="单位" width="110">
            <template #default="{ row }">
              <el-input v-model="row.unit" size="small" placeholder="单位" />
            </template>
          </el-table-column>
          <el-table-column label="判定" width="90" align="center">
            <template #default="{ row }">
              <span :class="judgeClass(row)">{{ itemResult(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeResultItem($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <p class="lab-report__result-tip text-secondary">
          判定规则：检测值 ≤ 限量值 为合格。存在不合格项时结论自动置为「不合格」。
        </p>
      </template>
      <template #footer>
        <el-button @click="resultVisible = false">取消</el-button>
        <el-button type="primary" :loading="resultSubmitting" @click="submitResult">
          提交结果
        </el-button>
      </template>
    </el-dialog>

    <!-- 送检任务详情 -->
    <el-dialog v-model="taskDetailVisible" title="送检任务详情" width="560px">
      <template v-if="taskDetail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="任务号">{{ taskDetail.taskNo }}</el-descriptions-item>
          <el-descriptions-item label="批次号">
            {{ taskDetail.batchNo }}（{{ taskDetail.crop }}）
          </el-descriptions-item>
          <el-descriptions-item label="检测机构">{{ taskDetail.lab }}</el-descriptions-item>
          <el-descriptions-item label="送检人">{{ taskDetail.sender }}</el-descriptions-item>
          <el-descriptions-item label="送检日期">{{ taskDetail.sendDate }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <AgriStatusTag :status="taskDetail.status" :map="TASK_STATUS_MAP" />
          </el-descriptions-item>
          <el-descriptions-item label="报告编号">
            {{ taskDetail.reportNo || '尚未生成' }}
          </el-descriptions-item>
        </el-descriptions>
        <div class="lab-report__task-items">
          <span class="lab-report__task-label">检测项：</span>
          <el-tag
            v-for="name in taskDetail.items"
            :key="name"
            class="lab-report__task-tag"
            type="info"
            effect="plain"
          >
            {{ name }}
          </el-tag>
        </div>
        <p class="lab-report__task-remark text-secondary">备注：{{ taskDetail.remark || '无' }}</p>
      </template>
      <template #footer>
        <el-button @click="taskDetailVisible = false">关闭</el-button>
        <el-button
          v-if="taskDetail?.status === 'REPORTED'"
          type="primary"
          @click="openReportByNo(taskDetail.reportNo)"
        >
          查看报告
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.lab-report__stats {
  margin-bottom: $space-sm;
}

.lab-report__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.lab-report__note {
  margin: 0 0 $space-sm;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.lab-report__tabs {
  margin-top: $space-xs;
}

.lab-report__section {
  margin-bottom: $space-md;
}

.lab-report__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-md;
  margin-bottom: $space-sm;
}

.lab-report__title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.lab-report__sub {
  display: block;
  margin-top: $space-xs;
  font-size: $font-size-xs;
}

.lab-report__actions {
  display: flex;
  flex: none;
  gap: $space-sm;
}

.lab-report__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.lab-report__drawer {
  min-height: 200px;
}

.lab-report__conclusion {
  display: flex;
  align-items: center;
  gap: $space-sm;
  margin: $space-md 0;
  padding: $space-sm $space-md;
  background: $bg-page;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.lab-report__conclusion-label {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.lab-report__conclusion-text {
  font-size: $font-size-sm;
  color: $text-secondary;
}

.lab-report__items-table {
  margin-bottom: $space-md;
}

.lab-report__paragraph {
  padding: $space-md;
  background: $bg-page;
  border-radius: $radius-md;
}

.lab-report__paragraph-title {
  margin: 0 0 $space-xs;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.lab-report__paragraph-text {
  margin: 0;
  font-size: $font-size-sm;
  line-height: 1.8;
  color: $text-regular;
}

.lab-report__download-hint {
  margin: $space-sm 0 0;
  font-size: $font-size-xs;
}

.lab-report__picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-sm;
}

.lab-report__picker-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $space-sm $space-md;
}

.lab-report__picker-item {
  margin-right: 0;
}

.lab-report__picker-unit {
  margin-left: $space-xs;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.lab-report__result-meta {
  margin: 0 0 $space-sm;
  font-size: $font-size-xs;
}

.lab-report__result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-sm;
}

.lab-report__sub-title {
  margin: 0;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.lab-report__result-table {
  width: 100%;
}

.lab-report__result-tip {
  margin: $space-sm 0 0;
  font-size: $font-size-xs;
}

.lab-report__full {
  width: 100%;
}

.lab-report__judge {
  font-size: $font-size-sm;
  color: $text-secondary;
}

.lab-report__judge.is-pass {
  color: $success-color;
}

.lab-report__judge.is-fail {
  color: $danger-color;
}

.lab-report__task-items {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-xs;
  margin-top: $space-md;
}

.lab-report__task-label {
  font-size: $font-size-sm;
  color: $text-regular;
}

.lab-report__task-tag {
  margin-right: 0;
}

.lab-report__task-remark {
  margin: $space-sm 0 0;
  font-size: $font-size-xs;
}
</style>
