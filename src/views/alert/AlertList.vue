<script setup>
/**
 * P025 告警列表
 * 职责：告警检索、统计卡、批量忽略、逐条处置与详情抽屉。
 * 说明：级别与状态使用 AgriStatusTag 的局部映射覆盖工程口径；
 *      持续时长以接口返回的实时时间为“现在”，不使用本机时钟。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { fetchAlarms, fetchAlarmDetail, fetchPlots, fetchRealtime, handleAlarm } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useTable } from '@/composables/useTable'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'AlertListPage' })

const LEVEL_MAP = {
  CRITICAL: { text: '紧急', type: 'danger' },
  MAJOR: { text: '重要', type: 'warning' },
  MINOR: { text: '一般', type: 'info' },
  INFO: { text: '提示', type: 'info' }
}

const STATUS_MAP = {
  PENDING: { text: '待处置', type: 'warning' },
  CONFIRMED: { text: '处置中', type: 'primary' },
  RESOLVED: { text: '已处置', type: 'success' },
  IGNORED: { text: '已忽略', type: 'info' }
}

const LEVEL_OPTIONS = [
  { label: '紧急', value: 'CRITICAL' },
  { label: '重要', value: 'MAJOR' },
  { label: '一般', value: 'MINOR' },
  { label: '提示', value: 'INFO' }
]

const STATUS_OPTIONS = [
  { label: '待处置', value: 'PENDING' },
  { label: '处置中', value: 'CONFIRMED' },
  { label: '已处置', value: 'RESOLVED' },
  { label: '已忽略', value: 'IGNORED' }
]

const userStore = useUserStore()
const query = ref({ keyword: '', level: '', status: '', range: [], plotId: '' })
const plotOptions = ref([])
const nowText = ref('')
const stats = ref({ pending: 0, todayNew: 0, critical: 0, avgResponse: 0 })
const statsLoading = ref(false)
const selectedRows = ref([])
const batchLoading = ref(false)
const tableRef = ref(null)
const tableError = ref(false)

const dialogVisible = ref(false)
const submitting = ref(false)
const handleTarget = ref(null)
const handleDefaults = computed(() => ({
  handleType: 'ONSITE',
  remark: '',
  handler: userStore.userName || '当前用户'
}))

const handleFields = [
  {
    prop: 'handleType',
    label: '处置方式',
    type: 'select',
    required: true,
    options: [
      { label: '现场处理', value: 'ONSITE' },
      { label: '远程处理', value: 'REMOTE' },
      { label: '误报忽略', value: 'FALSE_ALARM' }
    ]
  },
  {
    prop: 'handler',
    label: '处理人',
    type: 'input',
    required: true,
    placeholder: '请输入处理人'
  },
  {
    prop: 'remark',
    label: '处置说明',
    type: 'textarea',
    required: true,
    span: 2,
    rows: 4,
    placeholder: '请填写处置说明（至少 5 个字）'
  }
]

const handleRules = {
  handleType: [{ required: true, message: '请选择处置方式', trigger: 'change' }],
  handler: [{ required: true, message: '请输入处理人', trigger: 'blur' }],
  remark: [
    { required: true, message: '请填写处置说明', trigger: 'blur' },
    { min: 5, message: '处置说明至少 5 个字', trigger: 'blur' }
  ]
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailError = ref(false)
const detail = ref(null)
const relatedAlarms = ref([])

/**
 * 把搜索栏的 range 数组映射为接口的 from/to。
 * @param {Object} params useTable 合并后的参数
 * @returns {Promise<Object>} A19 分页数据
 */
function fetchAlarmList(params) {
  const { range, ...rest } = params
  return fetchAlarms({
    ...rest,
    from: Array.isArray(range) ? range[0] : '',
    to: Array.isArray(range) ? range[1] : ''
  })
}

const table = useTable(
  fetchAlarmList,
  { keyword: '', level: '', status: '', range: [], plotId: '' },
  { size: 10 }
)
const { list, loading, pagination, pageSizes } = table

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '告警编号 / 内容 / 设备',
    width: 230
  },
  {
    prop: 'level',
    label: '级别',
    type: 'select',
    placeholder: '全部级别',
    options: LEVEL_OPTIONS,
    width: 130
  },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: STATUS_OPTIONS,
    width: 140
  },
  {
    prop: 'range',
    label: '时间范围',
    type: 'daterange',
    width: 250
  },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plotOptions.value,
    width: 180
  }
])

const columns = [
  { prop: 'alarmNo', label: '告警编号', minWidth: 145 },
  { prop: 'level', label: '级别', width: 82, slot: 'level' },
  { prop: 'deviceName', label: '设备', minWidth: 140, slot: 'device' },
  { prop: 'plotName', label: '地块', width: 90 },
  {
    prop: 'content',
    label: '告警内容',
    minWidth: 184,
    showOverflowTooltip: true
  },
  { prop: 'createdAt', label: '触发时间', minWidth: 148 },
  { prop: 'duration', label: '持续时长', width: 96, slot: 'duration' },
  { prop: 'status', label: '状态', width: 86, slot: 'status' },
  { prop: 'ops', label: '操作', width: 110, fixed: 'right', slot: 'ops' }
]

const statCards = computed(() => [
  {
    label: '待处置',
    value: stats.value.pending,
    unit: '条',
    icon: 'Bell',
    tone: 'warn'
  },
  {
    label: '今日新增',
    value: stats.value.todayNew,
    unit: '条',
    icon: 'Plus',
    tone: 'brand'
  },
  {
    label: '紧急告警',
    value: stats.value.critical,
    unit: '条',
    icon: 'WarningFilled',
    tone: 'danger'
  },
  {
    label: '平均响应时长',
    value: stats.value.avgResponse,
    unit: '分钟',
    icon: 'Timer',
    tone: 'ok'
  }
])

const selectedCount = computed(() => selectedRows.value.length)

const detailTimeline = computed(() => {
  const row = detail.value
  if (!row) {
    return []
  }
  const items = [
    {
      time: row.createdAt,
      title: '告警触发',
      description: `${row.deviceName || '-'} · ${row.content || '-'}`,
      type: 'danger'
    }
  ]
  if (row.status === 'CONFIRMED') {
    items.push({
      time: row.handledAt || row.createdAt,
      title: '已确认，处置中',
      description: `处理人：${row.handledBy || '-'}`,
      type: 'primary'
    })
  }
  if (row.status === 'RESOLVED' || row.status === 'IGNORED') {
    items.push({
      time: row.handledAt || row.createdAt,
      title: row.status === 'IGNORED' ? '误报忽略' : '处置完成',
      description: `${row.handleRemark || '-'}（${row.handledBy || '-'}）`,
      type: row.status === 'IGNORED' ? 'info' : 'success'
    })
  }
  return items
})

/** 时间串转毫秒，兼容 Safari 的连字符问题 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/**
 * 持续时长：已处置取处置时间，未处置取接口返回的当前时间。
 * @param {Object} row 告警行
 * @returns {string} 中文时长
 */
function durationText(row) {
  if (!row?.createdAt) {
    return '-'
  }
  const start = toTimestamp(row.createdAt)
  const end = row.handledAt ? toTimestamp(row.handledAt) : toTimestamp(nowText.value)
  if (!start || !end || end < start) {
    return '-'
  }
  const minutes = Math.floor((end - start) / 60000)
  if (minutes < 1) {
    return '不足 1 分钟'
  }
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

/** 是否已进入终态 */
function isTerminal(row) {
  return row?.status === 'RESOLVED' || row?.status === 'IGNORED'
}

/** 载入接口返回的当前时间（A06） */
async function loadNow() {
  try {
    const data = await fetchRealtime({ plotId: 'PLOT-01' })
    nowText.value = data?.updatedAt || ''
  } catch {
    nowText.value = ''
  }
}

/** 载入地块下拉 */
async function loadPlots() {
  try {
    const data = await fetchPlots({ page: 1, size: 100 })
    plotOptions.value = (data?.list || []).map((plot) => ({
      label: plot.name,
      value: plot.id
    }))
  } catch {
    plotOptions.value = []
  }
}

/** 载入顶部统计（A19 全量聚合） */
async function loadStats() {
  statsLoading.value = true
  try {
    const data = await fetchAlarms({ page: 1, size: 100 })
    const rows = data?.list || []
    const reference = nowText.value || rows[0]?.createdAt || ''
    const today = reference ? String(reference).slice(0, 10) : ''
    const handled = rows.filter((row) => row.handledAt && row.createdAt)
    const responseMs = handled.map((row) => toTimestamp(row.handledAt) - toTimestamp(row.createdAt))
    stats.value = {
      pending: rows.filter((row) => row.status === 'PENDING').length,
      todayNew: rows.filter((row) => today && String(row.createdAt).startsWith(today)).length,
      critical: rows.filter((row) => row.level === 'CRITICAL').length,
      avgResponse: responseMs.length
        ? Math.round(
            (responseMs.reduce((sum, ms) => sum + Math.max(ms, 0), 0) / responseMs.length / 60000) *
              10
          ) / 10
        : 0
    }
  } catch {
    stats.value = { pending: 0, todayNew: 0, critical: 0, avgResponse: 0 }
  } finally {
    statsLoading.value = false
  }
}

/** 载入列表；40401 静默进空态 */
async function loadList() {
  tableError.value = false
  try {
    await table.loadData()
  } catch (err) {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  }
}

/**
 * 查询：写入过滤条件并回第 1 页。
 * @param {Object} [payload] 搜索栏条件
 */
function handleSearch(payload) {
  const source = payload || query.value
  table.filters.keyword = source.keyword || ''
  table.filters.level = source.level || ''
  table.filters.status = source.status || ''
  table.filters.range = Array.isArray(source.range) ? source.range : []
  table.filters.plotId = source.plotId || ''
  table.search().catch((err) => {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  })
}

/** 重置搜索条件 */
function handleReset() {
  query.value = { keyword: '', level: '', status: '', range: [], plotId: '' }
  handleSearch(query.value)
}

/** 翻页 */
async function handlePageChange(payload) {
  try {
    await table.onPageChange(payload)
  } catch (err) {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  }
}

/** 改每页条数 */
async function handleSizeChange(payload) {
  try {
    await table.onSizeChange(payload)
  } catch (err) {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  }
}

/** 勾选变化 */
function handleSelectionChange(rows) {
  selectedRows.value = rows || []
}

/** 批量忽略：逐条调 A20，全部结束后刷新列表与统计 */
async function batchIgnore() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选需要忽略的告警')
    return
  }
  const targets = selectedRows.value.filter((row) => !isTerminal(row))
  if (!targets.length) {
    ElMessage.warning('所选告警均已处置，无需重复操作')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认忽略选中的 ${targets.length} 条告警？忽略后可在列表中查看处置记录。`,
      '批量忽略',
      { type: 'warning', confirmButtonText: '确认忽略', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  batchLoading.value = true
  let success = 0
  let failed = 0
  for (const row of targets) {
    try {
      await handleAlarm(row.id, {
        status: 'IGNORED',
        remark: '批量忽略',
        handler: userStore.userName || '当前用户'
      })
      success += 1
    } catch {
      failed += 1
    }
  }
  batchLoading.value = false
  if (success) {
    ElMessage.success(`已忽略 ${success} 条告警${failed ? `，${failed} 条失败` : ''}`)
  } else {
    ElMessage.warning('批量忽略失败，请稍后重试')
  }
  tableRef.value?.clearSelection?.()
  await Promise.all([loadList(), loadStats()])
}

/**
 * 打开处置弹窗。
 * @param {Object} row 告警行
 */
function openHandle(row) {
  if (isTerminal(row)) {
    ElMessage.info('该告警已处置，无需重复操作')
    return
  }
  handleTarget.value = row
  dialogVisible.value = true
}

/**
 * 提交处置：现场/远程处理 → RESOLVED，误报忽略 → IGNORED。
 * @param {Object} payload 表单数据
 */
async function submitHandle(payload) {
  if (!handleTarget.value) {
    return
  }
  const status = payload.handleType === 'FALSE_ALARM' ? 'IGNORED' : 'RESOLVED'
  submitting.value = true
  try {
    const updated = await handleAlarm(handleTarget.value.id, {
      status,
      remark: payload.remark,
      handler: payload.handler
    })
    const row = list.value.find((item) => item.id === handleTarget.value.id)
    if (row) {
      Object.assign(row, updated || {}, {
        status,
        statusName: status === 'IGNORED' ? '已忽略' : '已处置',
        handledBy: payload.handler,
        handledAt: updated?.handledAt || nowText.value,
        handleRemark: payload.remark
      })
    }
    dialogVisible.value = false
    ElMessage.success(status === 'IGNORED' ? '告警已标记为误报并忽略' : '告警处置成功')
    // 表格按行对象缓存，重新拉取一次列表才能让状态标签立即刷新
    await Promise.all([loadList(), loadStats()])
  } catch (err) {
    if (err?.code === 40901) {
      ElMessage.closeAll()
      ElMessage.warning('该告警已处置，请勿重复提交')
    } else if (err?.code === 40301) {
      ElMessage.closeAll()
      ElMessage.warning('当前账号无此操作权限')
    }
  } finally {
    submitting.value = false
  }
}

/**
 * 打开详情抽屉：告警详情 + 同设备近 5 条。
 * @param {Object} row 告警行
 */
async function openDetail(row) {
  detailVisible.value = true
  detailLoading.value = true
  detailError.value = false
  detail.value = null
  relatedAlarms.value = []
  try {
    const [data, related] = await Promise.all([
      fetchAlarmDetail(row.id),
      fetchAlarms({ deviceCode: row.deviceCode, page: 1, size: 5 })
    ])
    detail.value = data
    relatedAlarms.value = (related?.list || []).filter((item) => item.id !== row.id).slice(0, 5)
  } catch (err) {
    if (err?.code !== 40401) {
      detailError.value = true
    }
  } finally {
    detailLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadNow(), loadPlots()])
  await Promise.all([loadStats(), loadList()])
})
</script>

<template>
  <div class="page-container alert-list">
    <AgriPageHeader
      page-id="P025"
      title="告警列表"
      description="集中查看设备与环境告警，支持批量忽略、逐条处置与处置记录追溯。"
    />

    <el-row :gutter="16" class="alert-list__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
          :loading="statsLoading"
        />
      </el-col>
    </el-row>

    <div class="agri-card alert-list__search">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card">
      <div class="alert-list__toolbar">
        <span class="alert-list__selected">已选 {{ selectedCount }} 条</span>
        <el-button
          type="warning"
          plain
          :loading="batchLoading"
          :disabled="!selectedCount"
          @click="batchIgnore"
        >
          批量忽略
        </el-button>
      </div>
      <div v-if="tableError" class="alert-list__error" @click="loadList">加载失败，点击重试</div>
      <AgriTable
        v-else
        ref="tableRef"
        :columns="columns"
        :data="list"
        :loading="loading"
        :total="pagination.total"
        :page="pagination.page"
        :size="pagination.size"
        :page-sizes="pageSizes"
        selection
        row-key="id"
        empty-text="暂无告警记录"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
        @selection-change="handleSelectionChange"
      >
        <template #level="{ row }">
          <AgriStatusTag :status="row.level" :map="LEVEL_MAP" />
        </template>
        <template #device="{ row }">
          <div class="alert-list__device">{{ row.deviceName }}</div>
          <div class="alert-list__sub">{{ row.deviceCode }}</div>
        </template>
        <template #duration="{ row }">
          {{ durationText(row) }}
        </template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="STATUS_MAP" />
        </template>
        <template #ops="{ row }">
          <el-button link type="primary" :disabled="isTerminal(row)" @click="openHandle(row)">
            处置
          </el-button>
          <el-button link @click="openDetail(row)">详情</el-button>
        </template>
      </AgriTable>
    </div>

    <AgriFormDialog
      v-model="dialogVisible"
      title="告警处置"
      :fields="handleFields"
      :rules="handleRules"
      :default-values="handleDefaults"
      :loading="submitting"
      width="560px"
      submit-text="提交处置"
      @submit="submitHandle"
      @closed="handleTarget = null"
    />

    <el-drawer v-model="detailVisible" title="告警详情" size="620px" direction="rtl">
      <div v-if="detailLoading" class="alert-list__detail-loading">加载中…</div>
      <div v-else-if="detailError" class="alert-list__detail-error">告警不存在或已被删除</div>
      <div v-else-if="detail" class="alert-list__detail">
        <div class="alert-list__detail-head">
          <div>
            <div class="alert-list__detail-title">{{ detail.alarmNo }}</div>
            <div class="alert-list__sub">{{ detail.typeName || detail.type }}</div>
          </div>
          <AgriStatusTag :status="detail.status" :map="STATUS_MAP" />
        </div>

        <div class="alert-list__content">
          <AgriStatusTag :status="detail.level" :map="LEVEL_MAP" />
          <span>{{ detail.content }}</span>
        </div>

        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="设备">{{ detail.deviceName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="设备编号">{{
            detail.deviceCode || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="地块">
            {{ detail.plot?.plotName || detail.plotName || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="监测指标">
            {{ detail.metric || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="触发值">
            {{ detail.triggerValue ?? '-' }}{{ detail.unit || '' }}
          </el-descriptions-item>
          <el-descriptions-item label="阈值">
            {{ detail.threshold ?? '-' }}{{ detail.unit || '' }}
          </el-descriptions-item>
          <el-descriptions-item label="触发时间">{{ detail.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="持续时长">{{ durationText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="处理人">{{ detail.handledBy || '-' }}</el-descriptions-item>
          <el-descriptions-item label="处理时间">{{
            detail.handledAt || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="处置说明" :span="2">
            {{ detail.handleRemark || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="alert-list__section">
          <div class="alert-list__section-title">同设备近 5 条告警</div>
          <div v-if="!relatedAlarms.length" class="alert-list__empty">暂无同设备其他告警</div>
          <ul v-else class="alert-list__related">
            <li v-for="item in relatedAlarms" :key="item.id" class="alert-list__related-item">
              <div class="alert-list__related-main">
                <span class="alert-list__related-time">{{ item.createdAt }}</span>
                <AgriStatusTag :status="item.level" :map="LEVEL_MAP" />
                <span class="alert-list__related-content">{{ item.content }}</span>
              </div>
              <span class="alert-list__sub">{{ item.statusName || '-' }}</span>
            </li>
          </ul>
        </div>

        <div class="alert-list__section">
          <div class="alert-list__section-title">处置记录</div>
          <el-timeline>
            <el-timeline-item
              v-for="(item, index) in detailTimeline"
              :key="index"
              :timestamp="item.time"
              :type="item.type"
            >
              <div class="alert-list__timeline-title">{{ item.title }}</div>
              <div class="alert-list__sub">{{ item.description }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.alert-list__stats,
.alert-list__search {
  margin-bottom: 16px;
}

.alert-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 12px;
}

.alert-list__selected {
  font-size: $font-size-sm;
  color: $text-secondary;
}

.alert-list__device {
  font-size: $font-size-sm;
  color: $text-primary;
}

.alert-list__sub {
  margin-top: 2px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.alert-list__detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.alert-list__detail-loading,
.alert-list__detail-error {
  padding: 60px 0;
  text-align: center;
  color: $text-secondary;
}

.alert-list__detail-error {
  color: $danger-color;
}

.alert-list__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.alert-list__detail-title {
  font-size: $font-size-lg;
  font-weight: 600;
  color: $text-primary;
}

.alert-list__content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  font-size: $font-size-sm;
  line-height: 1.7;
  color: $text-primary;
  background: $bg-page;
  border-radius: $radius-md;
}

.alert-list__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.alert-list__section-title {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.alert-list__empty {
  padding: 16px;
  font-size: $font-size-sm;
  color: $text-secondary;
  text-align: center;
  background: $bg-page;
  border-radius: $radius-md;
}

.alert-list__related {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.alert-list__related-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: $bg-page;
  border-radius: $radius-md;
}

.alert-list__related-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.alert-list__related-time {
  flex-shrink: 0;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.alert-list__related-content {
  overflow: hidden;
  font-size: $font-size-sm;
  color: $text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alert-list__timeline-title {
  font-size: $font-size-sm;
  color: $text-primary;
}

.alert-list__error {
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}
</style>
