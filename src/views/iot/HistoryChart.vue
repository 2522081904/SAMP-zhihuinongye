<script setup>
/**
 * P004 历史数据与趋势
 * 职责：按设备、时间范围与采样间隔拉取 A07 环境时序，支持多指标折线（双 Y 轴 + dataZoom），
 *      图下方提供同源数据表（前端分页）与 CSV 导出。
 * 交互约定：切换设备 / 时间范围 / 采样间隔 / 指标都会重新请求接口并重绘，而不是只改前端数据。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchDevices, fetchHistory } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'HistoryChartPage' })

// 指标字典：axis 0 = 左轴（温度 / 湿度 / 土壤湿度），axis 1 = 右轴（光照 / CO₂）
const METRIC_CONFIG = [
  { key: 'temperature', label: '空气温度', unit: '℃', color: '#2e7d58', axis: 0, digits: 1 },
  { key: 'humidity', label: '空气湿度', unit: '%', color: '#4c9f75', axis: 0, digits: 0 },
  { key: 'light', label: '光照强度', unit: 'lux', color: '#e6a23c', axis: 1, digits: 0 },
  { key: 'co2', label: 'CO₂ 浓度', unit: 'ppm', color: '#909399', axis: 1, digits: 0 },
  { key: 'soilMoisture', label: '土壤湿度', unit: '%', color: '#67c23a', axis: 0, digits: 0 }
]

// 采样间隔只取 mock 契约支持的档位（30/60/120/240），5/15 分钟会被 A07 以 40001 拒绝
const intervalOptions = [
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '2 小时', value: 120 },
  { label: '4 小时', value: 240 }
]

const rangeOptions = [
  { label: '近 24 小时', value: '24h' },
  { label: '近 7 天', value: '7d' },
  { label: '自定义', value: 'custom' }
]

// 设备下拉（A03 前 100 台）
const devices = ref([])
const devicesLoading = ref(false)
const devicesError = ref(false)

const selectedCode = ref('')
const rangePreset = ref('24h')
const customRange = ref([])
const interval = ref(60)
// 默认温湿度两条线，最多 4 条
const selectedMetrics = ref(['temperature', 'humidity'])

// 接口数据
const history = ref({ points: [] })
const loading = ref(false)
const chartError = ref(false)

// 表格前端分页
const tablePage = ref(1)
const tableSize = ref(10)
const exporting = ref(false)

const metricOptions = METRIC_CONFIG.map((item) => ({ label: item.label, value: item.key }))

const selectedMetricConfigs = computed(() =>
  METRIC_CONFIG.filter((item) => selectedMetrics.value.includes(item.key))
)

const currentDevice = computed(() => devices.value.find((item) => item.code === selectedCode.value))

const points = computed(() => history.value?.points || [])

// 表格数据：倒序（最新在上）后按页切片，数据只取一次
const tableRows = computed(() => {
  const rows = [...points.value].reverse()
  const start = (tablePage.value - 1) * tableSize.value
  return rows.slice(start, start + tableSize.value)
})

const tableColumns = computed(() => [
  { prop: 'time', label: '采样时间', minWidth: 170 },
  ...selectedMetricConfigs.value.map((metric) => ({
    prop: metric.key,
    label: `${metric.label}（${metric.unit}）`,
    minWidth: 150,
    slot: metric.key
  }))
])

// 曲线副标题：说明窗口与点数，便于核对是否真实重新取数
const chartSubtitle = computed(() => {
  const total = history.value?.total ?? points.value.length
  const from = history.value?.from || ''
  const to = history.value?.to || ''
  if (!total) {
    return ''
  }
  return `${from} 至 ${to} · 共 ${total} 个采样点 · 间隔 ${interval.value} 分钟`
})

// 折线图：左轴放温度/湿度/土壤湿度，右轴放光照/CO₂；带缩放条
const chartOption = computed(() => {
  const data = points.value
  if (!data.length || !selectedMetricConfigs.value.length) {
    return {}
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: selectedMetricConfigs.value.map((item) => item.label), top: 0 },
    grid: { left: 8, right: 12, bottom: 56, top: 44, containLabel: true },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', height: 20, bottom: 8 }
    ],
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.map((point) => String(point.time || '').slice(5, 16)),
      axisLabel: { hideOverlap: true }
    },
    yAxis: [
      { type: 'value', name: '温度 / 湿度', splitLine: { lineStyle: { type: 'dashed' } } },
      { type: 'value', name: '光照 / CO₂', splitLine: { show: false } }
    ],
    series: selectedMetricConfigs.value.map((metric) => ({
      name: metric.label,
      type: 'line',
      smooth: true,
      showSymbol: false,
      yAxisIndex: metric.axis,
      itemStyle: { color: metric.color },
      data: data.map((point) => point[metric.key])
    }))
  }
})

/**
 * 数值展示：保留指定小数位，缺数据时给占位符。
 * @param {*} value 原始值
 * @param {number} digits 小数位
 * @returns {string} 展示文案
 */
function formatMetric(value, digits = 1) {
  if (value === null || value === undefined || value === '') {
    return '--'
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '--'
}

/**
 * 把 'yyyy-MM-dd HH:mm:ss' 转成毫秒时间戳（斜杠替换兼容各浏览器解析差异）。
 * @param {string} text 时间文案
 * @returns {number} 毫秒时间戳，非法时 NaN
 */
function toTimestamp(text) {
  if (!text) {
    return NaN
  }
  return new Date(String(text).replace(/-/g, '/')).getTime()
}

/**
 * 毫秒时间戳格式化为 'yyyy-MM-dd HH:mm:ss'。
 * @param {number} ms 毫秒时间戳
 * @returns {string} 时间文案
 */
function formatTimestamp(ms) {
  const date = new Date(ms)
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** 载入设备下拉：失败时给重试入口，不影响页面其他区域 */
async function loadDevices() {
  devicesError.value = false
  devicesLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, size: 100 })
    devices.value = data?.list || []
    if (!selectedCode.value && devices.value.length) {
      // 默认选温湿度传感器，其次第一台设备
      const preferred = devices.value.find((item) => item.type === 'TH') || devices.value[0] || null
      selectedCode.value = preferred?.code || ''
    }
  } catch (err) {
    devices.value = []
    if (err?.code !== 40401) {
      devicesError.value = true
    }
  } finally {
    devicesLoading.value = false
  }
}

/**
 * 载入历史数据：按当前设备 / 时间范围 / 采样间隔请求 A07。
 * 7 天窗口以接口返回的末点时间（to）为基准回推，避免依赖本机时钟。
 */
async function loadHistory() {
  if (!selectedCode.value) {
    history.value = { points: [] }
    return
  }
  chartError.value = false
  loading.value = true
  try {
    const params = { deviceCode: selectedCode.value, interval: interval.value }
    if (rangePreset.value === '7d') {
      const base = toTimestamp(history.value?.to || currentDevice.value?.lastSeen)
      if (Number.isFinite(base)) {
        params.from = formatTimestamp(base - 7 * 24 * 60 * 60 * 1000)
        params.to = formatTimestamp(base)
      }
    } else if (rangePreset.value === 'custom') {
      if (Array.isArray(customRange.value) && customRange.value.length === 2) {
        params.from = customRange.value[0]
        params.to = customRange.value[1]
      }
    }
    history.value = await fetchHistory(params)
    tablePage.value = 1
  } catch (err) {
    history.value = { points: [] }
    if (err?.code !== 40401) {
      chartError.value = true
    }
  } finally {
    loading.value = false
  }
}

/** 时间范围切换：自定义需等日期选完再请求 */
function handleRangeChange() {
  if (rangePreset.value === 'custom' && (customRange.value || []).length !== 2) {
    return
  }
  loadHistory()
}

/**
 * 指标勾选变化：至少保留一条线；随后重新请求，保证图与表同源。
 * @param {string[]} value 勾选中的指标
 */
function handleMetricsChange(value) {
  if (!value.length) {
    selectedMetrics.value = [selectedMetricConfigs.value[0]?.key || 'temperature']
    return
  }
  loadHistory()
}

/**
 * 表格翻页（前端切片，不再请求接口）。
 * @param {{page:number,size:number}} payload 分页事件
 */
function handleTablePageChange(payload) {
  tablePage.value = payload.page
  tableSize.value = payload.size
}

/**
 * 表格切换每页条数（前端切片）。
 * @param {{page:number,size:number}} payload 分页事件
 */
function handleTableSizeChange(payload) {
  tablePage.value = 1
  tableSize.value = payload.size
}

/**
 * CSV 单元格转义：统一加引号，内部引号双写。
 * @param {*} value 原始值
 * @returns {string} 转义后的单元格
 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 前端生成 CSV 并触发下载（UTF-8 BOM，Excel 打开中文不乱码）。
 * @param {string} filename 文件名
 * @param {string[]} header 表头
 * @param {Array<Array<*>>} rows 数据行
 */
function downloadCsv(filename, header, rows) {
  const content = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** 导出当前设备与窗口的全部采样点（不受表格分页影响） */
function handleExport() {
  if (exporting.value) {
    return
  }
  if (!points.value.length) {
    ElMessage.warning('当前条件下没有可导出的数据')
    return
  }
  exporting.value = true
  try {
    const header = ['采样时间', ...selectedMetricConfigs.value.map((item) => item.label)]
    const rows = points.value.map((point) => [
      point.time,
      ...selectedMetricConfigs.value.map((item) => point[item.key])
    ])
    const deviceName = currentDevice.value?.code || selectedCode.value
    downloadCsv(`历史数据_${deviceName}_${interval.value}分钟.csv`, header, rows)
    ElMessage.success(`已导出 ${rows.length} 条采样点`)
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  await loadDevices()
  loadHistory()
})

// 设备切换后要换曲线，同时把表格回到第 1 页
watch(selectedCode, () => {
  loadHistory()
})
</script>

<template>
  <div class="page-container history-chart">
    <AgriPageHeader
      page-id="P004"
      title="历史数据与趋势"
      description="按设备与时间窗口查看环境时序曲线，支持多指标对比、采样间隔切换与原始数据导出。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadHistory">刷新</el-button>
        <el-button type="primary" :loading="exporting" @click="handleExport">导出 CSV</el-button>
      </template>
    </AgriPageHeader>

    <!-- 查询区：设备 / 时间范围 / 采样间隔 -->
    <div class="agri-card history-chart__section">
      <div class="history-chart__filters">
        <div class="history-chart__field">
          <span class="history-chart__label">设备</span>
          <el-select
            v-model="selectedCode"
            :loading="devicesLoading"
            filterable
            placeholder="请选择设备"
            class="history-chart__device"
          >
            <el-option
              v-for="item in devices"
              :key="item.code"
              :label="`${item.name}（${item.code}）`"
              :value="item.code"
            />
          </el-select>
        </div>
        <div class="history-chart__field">
          <span class="history-chart__label">时间范围</span>
          <el-radio-group v-model="rangePreset" @change="handleRangeChange">
            <el-radio-button v-for="item in rangeOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="rangePreset === 'custom'" class="history-chart__field">
          <span class="history-chart__label">自定义</span>
          <el-date-picker
            v-model="customRange"
            type="datetimerange"
            value-format="YYYY-MM-DD HH:mm:ss"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            @change="handleRangeChange"
          />
        </div>
        <div class="history-chart__field">
          <span class="history-chart__label">采样间隔</span>
          <el-select v-model="interval" class="history-chart__interval" @change="loadHistory">
            <el-option
              v-for="item in intervalOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
      </div>
      <div class="history-chart__metrics">
        <span class="history-chart__label">指标（最多 4 条）</span>
        <el-checkbox-group v-model="selectedMetrics" :max="4" @change="handleMetricsChange">
          <el-checkbox v-for="item in metricOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
    </div>

    <!-- 趋势曲线 -->
    <div class="agri-card history-chart__section">
      <div class="history-chart__section-head">
        <h3 class="history-chart__section-title">趋势曲线</h3>
        <span class="text-secondary">{{ chartSubtitle || '暂无数据' }}</span>
      </div>
      <div v-if="devicesError" class="history-chart__error" @click="loadDevices">
        加载失败，点击重试
      </div>
      <AgriEmpty
        v-else-if="!devicesLoading && !devices.length"
        :height="260"
        description="暂无可用设备，请先在设备总览确认台账"
      />
      <div v-else-if="chartError" class="history-chart__error" @click="loadHistory">
        加载失败，点击重试
      </div>
      <AgriChart
        v-else
        :option="chartOption"
        :loading="loading"
        :height="360"
        empty-text="所选设备在该时间窗口内暂无数据"
      />
    </div>

    <!-- 数据明细：一次性拿到后前端切页 -->
    <div class="agri-card history-chart__section">
      <div class="history-chart__section-head">
        <h3 class="history-chart__section-title">数据明细</h3>
        <span class="text-secondary">共 {{ points.length }} 条采样点</span>
      </div>
      <AgriTable
        :columns="tableColumns"
        :data="tableRows"
        :loading="loading"
        :total="points.length"
        :page="tablePage"
        :size="tableSize"
        :page-sizes="[10, 20, 50]"
        empty-text="暂无采样数据"
        @page-change="handleTablePageChange"
        @size-change="handleTableSizeChange"
      >
        <template #temperature="{ value }">{{ formatMetric(value, 1) }}</template>
        <template #humidity="{ value }">{{ formatMetric(value, 0) }}</template>
        <template #light="{ value }">{{ formatMetric(value, 0) }}</template>
        <template #co2="{ value }">{{ formatMetric(value, 0) }}</template>
        <template #soilMoisture="{ value }">{{ formatMetric(value, 0) }}</template>
      </AgriTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.history-chart__section {
  margin-bottom: $space-md;
}

.history-chart__filters {
  display: flex;
  flex-wrap: wrap;
  gap: $space-md;
  align-items: center;
}

.history-chart__field {
  display: flex;
  align-items: center;
  gap: $space-sm;
}

.history-chart__label {
  font-size: $font-size-sm;
  color: $text-secondary;
  white-space: nowrap;
}

.history-chart__device {
  width: 260px;
}

.history-chart__interval {
  width: 130px;
}

.history-chart__metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-sm;
  margin-top: $space-md;
  padding-top: $space-md;
  border-top: 1px dashed $border-color;
}

.history-chart__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.history-chart__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.history-chart__error {
  padding: $space-lg 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;

  &:hover {
    border-color: $danger-color;
  }
}

@media (max-width: $breakpoint-sm) {
  .history-chart__device {
    width: 100%;
  }

  .history-chart__field {
    flex-wrap: wrap;
  }
}
</style>
