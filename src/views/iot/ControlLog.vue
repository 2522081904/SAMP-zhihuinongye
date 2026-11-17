<script setup>
/**
 * P009 控制日志
 * 职责：按时间范围、设备、操作人、指令类型与结果检索 A09 控制日志，
 *      展示耗时、幂等号，并支持展开查看完整 JSON、复制与导出 CSV。
 * 说明：mock 日志没有 params / duration 字段，耗时由 finishedAt-createdAt 计算，
 *      参数按指令字段还原后在抽屉中以 JSON 展示。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchControlLogs, fetchDevices } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useTable } from '@/composables/useTable'

defineOptions({ name: 'ControlLogPage' })

const RESULT_MAP = {
  SUCCESS: { text: '成功', type: 'success' },
  FAILED: { text: '失败', type: 'danger' },
  TIMEOUT: { text: '超时', type: 'warning' }
}

const ACTION_OPTIONS = [
  { label: '开机 ON', value: 'ON' },
  { label: '停机 OFF', value: 'OFF' },
  { label: '开启 OPEN', value: 'OPEN' },
  { label: '关闭 CLOSE', value: 'CLOSE' },
  { label: '模式切换 SET_MODE', value: 'SET_MODE' },
  { label: '重启 RESTART', value: 'RESTART' }
]

const query = ref({ range: [], deviceCode: '', operator: '', status: '', action: '' })
const devices = ref([])
const operators = ref([])
const stats = ref({ today: 0, successRate: 0, avgDuration: 0, failed: 0 })
const statsLoading = ref(false)
const exporting = ref(false)
const detailVisible = ref(false)
const activeLog = ref(null)

/**
 * 把搜索栏的 range 数组映射为接口的 from/to。
 * @param {Object} params useTable 合并后的参数
 * @returns {Promise<Object>} A09 分页数据
 */
function fetchLogs(params) {
  const { range, ...rest } = params
  return fetchControlLogs({
    ...rest,
    from: Array.isArray(range) ? range[0] : '',
    to: Array.isArray(range) ? range[1] : ''
  })
}

const table = useTable(
  fetchLogs,
  { range: [], deviceCode: '', operator: '', status: '', action: '' },
  { size: 10 }
)
const { list, loading, pagination, pageSizes } = table
const tableError = ref(false)

const deviceOptions = computed(() =>
  devices.value.map((device) => ({
    label: `${device.name}（${device.code}）`,
    value: device.code
  }))
)

const operatorOptions = computed(() =>
  operators.value.map((name) => ({ label: name, value: name }))
)

const searchFields = computed(() => [
  {
    prop: 'range',
    label: '时间范围',
    type: 'daterange',
    width: 250
  },
  {
    prop: 'deviceCode',
    label: '设备',
    type: 'select',
    placeholder: '全部设备',
    options: deviceOptions.value,
    width: 220
  },
  {
    prop: 'operator',
    label: '操作人',
    type: 'select',
    placeholder: '全部操作人',
    options: operatorOptions.value,
    width: 150
  },
  {
    prop: 'status',
    label: '结果',
    type: 'select',
    placeholder: '全部结果',
    options: [
      { label: '成功', value: 'SUCCESS' },
      { label: '失败', value: 'FAILED' },
      { label: '超时', value: 'TIMEOUT' }
    ],
    width: 130
  },
  {
    prop: 'action',
    label: '指令类型',
    type: 'select',
    placeholder: '全部指令',
    options: ACTION_OPTIONS,
    width: 180
  }
])

const columns = [
  { prop: 'createdAt', label: '时间', minWidth: 168 },
  { prop: 'deviceName', label: '设备', minWidth: 170, slot: 'device' },
  { prop: 'action', label: '指令', width: 110, slot: 'action' },
  { prop: 'params', label: '参数摘要', minWidth: 170, slot: 'params' },
  { prop: 'operator', label: '操作人', width: 100 },
  { prop: 'status', label: '结果', width: 90, slot: 'status' },
  { prop: 'duration', label: '耗时', width: 100, slot: 'duration' },
  { prop: 'requestId', label: '请求编号', minWidth: 221, slot: 'requestId' }
]

const statCards = computed(() => [
  { label: '今日指令', value: stats.value.today, unit: '条', icon: 'Tickets', tone: 'brand' },
  { label: '成功率', value: stats.value.successRate, unit: '%', icon: 'CircleCheck', tone: 'ok' },
  {
    label: '平均耗时',
    value: stats.value.avgDuration,
    unit: 'ms',
    icon: 'Timer',
    tone: 'warn'
  },
  { label: '失败数', value: stats.value.failed, unit: '条', icon: 'Warning', tone: 'danger' }
])

const detailJson = computed(() => {
  if (!activeLog.value) {
    return ''
  }
  const row = activeLog.value
  return JSON.stringify(
    {
      logNo: row.logNo,
      requestId: row.requestId,
      device: {
        code: row.deviceCode,
        name: row.deviceName,
        plotName: row.plotName
      },
      action: row.action,
      actionName: row.actionName,
      params: { action: row.action },
      operator: row.operator,
      source: row.source,
      sourceName: row.sourceName,
      status: row.status,
      statusName: row.statusName,
      result: row.result,
      timing: {
        createdAt: row.createdAt,
        finishedAt: row.finishedAt,
        durationMs: durationOf(row)
      },
      receipt: {
        status: row.status,
        result: row.result,
        finishedAt: row.finishedAt
      }
    },
    null,
    2
  )
})

/**
 * 计算耗时（毫秒）。
 * @param {Object} row 日志行
 * @returns {number} 毫秒，非法为 0
 */
function durationOf(row) {
  const start = toTimestamp(row?.createdAt)
  const end = toTimestamp(row?.finishedAt)
  if (!start || !end || end < start) {
    return 0
  }
  return end - start
}

/**
 * 兼容不同平台的时间解析。
 * @param {string} text 时间串
 * @returns {number} 毫秒时间戳
 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 参数摘要：mock 没有 params，用动作编码还原一个稳定结构 */
function paramsSummary(row) {
  return JSON.stringify({ action: row?.action || '' })
}

/** 载入设备与操作人下拉选项 */
async function loadOptions() {
  try {
    const [deviceData, logData] = await Promise.all([
      fetchDevices({ page: 1, size: 100 }),
      fetchControlLogs({ page: 1, size: 100 })
    ])
    devices.value = deviceData?.list || []
    operators.value = [...new Set((logData?.list || []).map((row) => row.operator).filter(Boolean))]
  } catch {
    devices.value = []
    operators.value = []
  }
}

/** 载入顶部统计（A09 全量前端聚合） */
async function loadStats() {
  statsLoading.value = true
  try {
    const data = await fetchControlLogs({ page: 1, size: 100 })
    const rows = data?.list || []
    const latestDay = rows[0]?.createdAt ? String(rows[0].createdAt).slice(0, 10) : ''
    const todayRows = rows.filter((row) => latestDay && String(row.createdAt).startsWith(latestDay))
    const successCount = rows.filter((row) => row.status === 'SUCCESS').length
    const durations = rows.map(durationOf).filter((ms) => ms > 0)
    stats.value = {
      today: todayRows.length,
      successRate: rows.length ? Math.round((successCount / rows.length) * 1000) / 10 : 0,
      avgDuration: durations.length
        ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
        : 0,
      failed: rows.filter((row) => row.status === 'FAILED').length
    }
  } catch {
    stats.value = { today: 0, successRate: 0, avgDuration: 0, failed: 0 }
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
  table.filters.range = Array.isArray(source.range) ? source.range : []
  table.filters.deviceCode = source.deviceCode || ''
  table.filters.operator = source.operator || ''
  table.filters.status = source.status || ''
  table.filters.action = source.action || ''
  table.search().catch((err) => {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  })
}

/** 重置搜索条件 */
function handleReset() {
  query.value = { range: [], deviceCode: '', operator: '', status: '', action: '' }
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

/**
 * 打开详情抽屉。
 * @param {Object} row 日志行
 */
function openDetail(row) {
  activeLog.value = row
  detailVisible.value = true
}

/**
 * 复制文本，优先 Clipboard API，失败时用隐藏 textarea 兜底。
 * @param {string} text 待复制内容
 * @param {string} [tip] 成功提示
 */
async function copyText(text, tip = '已复制') {
  if (!text) {
    return
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    ElMessage.success(tip)
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

/** CSV 单元格转义 */
function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** 按当前过滤条件导出 CSV */
async function exportCsv() {
  exporting.value = true
  try {
    const range = table.filters.range || []
    const data = await fetchControlLogs({
      keyword: table.filters.keyword,
      deviceCode: table.filters.deviceCode,
      operator: table.filters.operator,
      status: table.filters.status,
      action: table.filters.action,
      from: range[0] || '',
      to: range[1] || '',
      page: 1,
      size: 100
    })
    const rows = data?.list || []
    if (!rows.length) {
      ElMessage.warning('当前条件下没有可导出的日志')
      return
    }
    const header = ['时间', '设备', '指令', '参数摘要', '操作人', '结果', '耗时(ms)', '请求编号']
    const lines = rows.map((row) =>
      [
        row.createdAt,
        row.deviceName,
        row.actionName,
        paramsSummary(row),
        row.operator,
        row.statusName,
        durationOf(row),
        row.requestId
      ]
        .map(csvCell)
        .join(',')
    )
    const csv = `\uFEFF${header.map(csvCell).join(',')}\r\n${lines.join('\r\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '控制日志.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${rows.length} 条控制日志`)
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.warning('导出失败，请稍后重试')
    }
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadOptions(), loadStats()])
  await loadList()
})
</script>

<template>
  <div class="page-container control-log">
    <AgriPageHeader
      page-id="P009"
      title="控制日志"
      description="检索设备控制指令的下发记录、执行结果与幂等请求编号。"
    >
      <template #extra>
        <el-button :loading="exporting" @click="exportCsv">导出 CSV</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="control-log__stats">
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

    <div class="agri-card control-log__search">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card">
      <div v-if="tableError" class="control-log__error" @click="loadList">加载失败，点击重试</div>
      <AgriTable
        v-else
        :columns="columns"
        :data="list"
        :loading="loading"
        :total="pagination.total"
        :page="pagination.page"
        :size="pagination.size"
        :page-sizes="pageSizes"
        row-key="id"
        empty-text="暂无控制日志"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
        @row-click="openDetail"
      >
        <template #device="{ row }">
          <div class="control-log__device">{{ row.deviceName }}</div>
          <div class="control-log__sub">{{ row.deviceCode }}</div>
        </template>
        <template #action="{ row }">
          <div>{{ row.actionName }}</div>
          <div class="control-log__sub">{{ row.action }}</div>
        </template>
        <template #params="{ row }">
          <span class="control-log__params">{{ paramsSummary(row) }}</span>
        </template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="RESULT_MAP" />
        </template>
        <template #duration="{ row }">
          {{ durationOf(row) ? `${durationOf(row)} ms` : '-' }}
        </template>
        <template #requestId="{ row }">
          <div class="control-log__request">
            <el-tooltip :content="row.requestId" placement="top">
              <span class="control-log__request-text">{{ row.requestId }}</span>
            </el-tooltip>
            <el-button
              link
              type="primary"
              class="control-log__copy"
              @click.stop="copyText(row.requestId, '请求编号已复制')"
            >
              复制
            </el-button>
          </div>
        </template>
      </AgriTable>
    </div>

    <el-drawer v-model="detailVisible" title="控制指令详情" size="560px" direction="rtl">
      <div v-if="activeLog" class="control-log__detail">
        <div class="control-log__detail-head">
          <div>
            <div class="control-log__detail-title">{{ activeLog.logNo }}</div>
            <div class="control-log__sub">{{ activeLog.requestId }}</div>
          </div>
          <AgriStatusTag :status="activeLog.status" :map="RESULT_MAP" />
        </div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="设备">{{ activeLog.deviceName }}</el-descriptions-item>
          <el-descriptions-item label="地块">{{ activeLog.plotName }}</el-descriptions-item>
          <el-descriptions-item label="指令">
            {{ activeLog.actionName }}（{{ activeLog.action }}）
          </el-descriptions-item>
          <el-descriptions-item label="操作人">{{ activeLog.operator }}</el-descriptions-item>
          <el-descriptions-item label="下发时间">{{ activeLog.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ activeLog.finishedAt }}</el-descriptions-item>
          <el-descriptions-item label="耗时">
            {{ durationOf(activeLog) ? `${durationOf(activeLog)} ms` : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="来源">
            {{ activeLog.sourceName || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="执行结果" :span="2">
            {{ activeLog.result || '-' }}
          </el-descriptions-item>
        </el-descriptions>
        <div class="control-log__json-head">
          <span>完整参数与回执 JSON</span>
          <el-button link type="primary" @click="copyText(detailJson, 'JSON 已复制')">
            复制 JSON
          </el-button>
        </div>
        <pre class="control-log__json">{{ detailJson }}</pre>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.control-log__stats {
  margin-bottom: 16px;
}

.control-log__search {
  margin-bottom: 16px;
}

.control-log__device {
  font-size: $font-size-sm;
  color: $text-primary;
}

.control-log__sub {
  margin-top: 2px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.control-log__params {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-primary;
}

.control-log__request {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-log__request-text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-secondary;
  white-space: nowrap;
}

.control-log__copy {
  flex-shrink: 0;
}

.control-log__detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-log__detail-head,
.control-log__json-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.control-log__detail-title {
  font-size: $font-size-lg;
  font-weight: 600;
  color: $text-primary;
}

.control-log__json-head {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.control-log__json {
  max-height: 420px;
  padding: 14px;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #d7e3f4;
  background: #1f2d3d;
  border-radius: $radius-md;
  white-space: pre-wrap;
  word-break: break-all;
}

.control-log__error {
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}
</style>
