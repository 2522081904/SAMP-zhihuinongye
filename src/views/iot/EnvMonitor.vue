<script setup>
/**
 * P002 环境数据监测
 * 职责：实时展示地块空气温湿度、土壤湿度与光照指标，并按设备维度查看温湿度曲线；
 *      下方补充设备实时状态与最近待处置告警，形成一屏可用的监测视图。
 * 数据来源：A01/A02 地块列表、A03 设备台账、A06 实时环境、A07 历史时序、A19 告警列表。
 * 交互约定：页面只做「取数 + 组装」，错误在页面内以「加载失败，点击重试」呈现，
 *          40401（目标不存在）按空态处理，不弹全局提示。
 */
import { computed, onMounted, ref } from 'vue'

import { fetchAlarms, fetchDevices, fetchHistory, fetchPlots, fetchRealtime } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useTable } from '@/composables/useTable'

defineOptions({ name: 'EnvMonitorPage' })

// 查询条件（搜索栏双向绑定）与已生效条件（点查询后才更新）
const query = ref({ plotId: '', deviceType: '', range: [] })
const applied = ref({ plotId: '', deviceType: '', range: [] })

// 地块下拉数据
const plots = ref([])
const plotsLoading = ref(false)

// 设备类型下拉：从设备台账动态汇总，避免在前端重复维护后端字典
const deviceTypes = ref([])
const typesLoading = ref(false)

// 实时环境数据与指标卡状态
const realtime = ref(null)
const realtimeLoading = ref(false)
const realtimeError = ref(false)

// 指标卡的环比基准：默认取温湿度传感器最近 24 小时的首末点
const trendPoints = ref([])

// 曲线状态
const history = ref({ points: [] })
const historyLoading = ref(false)
const historyError = ref(false)
const chartDeviceCode = ref('')

const deviceTypeOptions = computed(() => [{ label: '全部类型', value: '' }, ...deviceTypes.value])

const searchFields = computed(() => [
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id })),
    width: 240
  },
  {
    prop: 'deviceType',
    label: '设备类型',
    type: 'select',
    placeholder: '全部类型',
    options: deviceTypeOptions.value,
    width: 180
  },
  {
    prop: 'range',
    label: '时间范围',
    type: 'daterange',
    width: 320
  }
])

// 设备状态表：按地块与设备类型过滤，走接口分页
/** 汇总设备类型字典：以设备台账返回的 type/typeName 为准 */
async function loadDeviceTypes() {
  typesLoading.value = true
  try {
    const data = await fetchDevices({ page: 1, size: 100 })
    const map = new Map()
    ;(data?.list || []).forEach((device) => {
      if (device.type && !map.has(device.type)) {
        map.set(device.type, device.typeName || device.type)
      }
    })
    deviceTypes.value = [...map.entries()].map(([value, label]) => ({ value, label }))
  } catch {
    deviceTypes.value = []
  } finally {
    typesLoading.value = false
  }
}

const deviceTable = useTable(fetchDevices, { plotId: '', type: '' })
const {
  list: deviceList,
  loading: deviceLoading,
  pagination: devicePagination,
  pageSizes: devicePageSizes
} = deviceTable
const deviceError = ref(false)
const deviceColumns = [
  { prop: 'code', label: '设备编号', minWidth: 150, showOverflowTooltip: true },
  { prop: 'name', label: '设备名称', minWidth: 150, showOverflowTooltip: true },
  { prop: 'typeName', label: '设备类型', minWidth: 130 },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'lastSeen', label: '最后上报时间', minWidth: 170 },
  { prop: 'action', label: '操作', width: 110, align: 'center', slot: 'action' }
]

// 最近待处置告警：固定 status=PENDING，每页 5 条
const alarmTable = useTable(fetchAlarms, { status: 'PENDING' }, { size: 5, pageSizes: [5, 10, 20] })
const {
  list: alarmList,
  loading: alarmLoading,
  pagination: alarmPagination,
  pageSizes: alarmPageSizes
} = alarmTable
const alarmError = ref(false)
const alarmColumns = [
  { prop: 'level', label: '级别', width: 90, slot: 'level' },
  { prop: 'deviceName', label: '设备', minWidth: 150, showOverflowTooltip: true },
  { prop: 'content', label: '告警内容', minWidth: 240, showOverflowTooltip: true },
  { prop: 'createdAt', label: '时间', minWidth: 170 }
]

// 图表数据源：当前选中设备的时序点
const chartPoints = computed(() => history.value?.points || [])
const chartDeviceName = computed(() => history.value?.deviceName || '')
const chartSubtitle = computed(() => {
  if (!chartDeviceName.value) {
    return ''
  }
  const range = applied.value.range
  if (Array.isArray(range) && range.length === 2) {
    return `${chartDeviceName.value} · ${range[0].slice(0, 10)} 至 ${range[1].slice(0, 10)}`
  }
  return `${chartDeviceName.value} · 最近 24 小时`
})

// 折线图：温度走左轴，湿度走右轴
const chartOption = computed(() => {
  const points = chartPoints.value
  if (!points.length) {
    return {}
  }
  const times = points.map((point) => String(point.time || '').slice(5, 16))
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['空气温度', '空气湿度'], top: 0, right: 0 },
    grid: { left: 8, right: 8, bottom: 8, top: 40, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: times,
      axisLabel: { hideOverlap: true }
    },
    yAxis: [
      { type: 'value', name: '温度(℃)', splitLine: { lineStyle: { type: 'dashed' } } },
      { type: 'value', name: '湿度(%)', splitLine: { show: false } }
    ],
    series: [
      {
        name: '空气温度',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: points.map((point) => point.temperature)
      },
      {
        name: '空气湿度',
        type: 'line',
        smooth: true,
        showSymbol: false,
        yAxisIndex: 1,
        data: points.map((point) => point.humidity)
      }
    ]
  }
})

/**
 * 数值展示：保留指定小数位，无数据时显示占位符。
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
 * 计算某指标的环比：末点相对首点的变化百分比。
 * @param {string} key 指标字段
 * @returns {{trend:string, delta:string}} 趋势方向与文案
 */
function metricTrend(key) {
  const points = trendPoints.value
  if (points.length < 2) {
    return { trend: '', delta: '' }
  }
  const first = Number(points[0][key])
  const last = Number(points[points.length - 1][key])
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return { trend: 'flat', delta: '0.0%' }
  }
  const diff = ((last - first) / Math.abs(first)) * 100
  if (Math.abs(diff) < 0.05) {
    return { trend: 'flat', delta: '0.0%' }
  }
  return {
    trend: diff > 0 ? 'up' : 'down',
    delta: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`
  }
}

// 四张指标卡：数值来自 A06 实时数据，环比来自 A07 最近 24 小时首末点
const statCards = computed(() => {
  const metrics = realtime.value?.metrics || {}
  return [
    {
      label: '空气温度',
      value: formatMetric(metrics.temperature, 1),
      unit: '℃',
      icon: 'Sunny',
      tone: 'brand',
      ...metricTrend('temperature')
    },
    {
      label: '空气湿度',
      value: formatMetric(metrics.humidity, 0),
      unit: '%',
      icon: 'Cloudy',
      tone: 'ok',
      ...metricTrend('humidity')
    },
    {
      label: '土壤湿度',
      value: formatMetric(metrics.soilMoisture, 0),
      unit: '%',
      icon: 'Pouring',
      tone: 'warn',
      ...metricTrend('soilMoisture')
    },
    {
      label: '光照强度',
      value: formatMetric(metrics.light, 0),
      unit: 'lux',
      icon: 'Odometer',
      tone: 'brand',
      ...metricTrend('light')
    }
  ]
})

// 当前地块内的传感器设备，用于曲线设备下拉/默认值
const sensorDevices = computed(() =>
  (realtime.value?.devices || []).filter((device) => device.category === 'SENSOR')
)

/** 载入地块下拉数据 */
async function loadPlots() {
  plotsLoading.value = true
  try {
    const data = await fetchPlots({ page: 1, size: 100 })
    plots.value = data?.list || []
  } catch {
    plots.value = []
  } finally {
    plotsLoading.value = false
  }
}

/**
 * 选默认曲线设备：优先实时数据里与设备类型条件匹配的传感器，
 * 其次温湿度传感器，再次第一个传感器。
 * @returns {string} 设备编码
 */
function pickChartDevice() {
  const candidates = sensorDevices.value
  if (!candidates.length) {
    return ''
  }
  const type = applied.value.deviceType
  if (type) {
    const matched = candidates.find((device) => device.type === type)
    if (matched) {
      return matched.code
    }
  }
  const th = candidates.find((device) => device.type === 'TH')
  return (th || candidates[0]).code
}

/**
 * 载入曲线数据：按当前设备与已生效时间范围取 A07。
 * @param {string} [deviceCode] 指定设备，缺省用当前设备
 */
async function loadHistory(deviceCode) {
  const code = deviceCode || chartDeviceCode.value
  if (!code) {
    history.value = { points: [] }
    return
  }
  chartDeviceCode.value = code
  historyError.value = false
  historyLoading.value = true
  try {
    const params = { deviceCode: code, interval: 60 }
    const range = applied.value.range
    if (Array.isArray(range) && range.length === 2) {
      params.from = range[0]
      params.to = range[1]
    }
    history.value = await fetchHistory(params)
  } catch (err) {
    history.value = { points: [] }
    // 40401 视为该设备暂无时序数据，按空态展示
    if (err?.code !== 40401) {
      historyError.value = true
    }
  } finally {
    historyLoading.value = false
  }
}

/**
 * 载入环比基准数据：默认取温湿度传感器最近 24 小时。
 * @param {Array} devices 实时数据中的设备列表
 */
async function loadTrend(devices) {
  const sensors = (devices || []).filter((device) => device.category === 'SENSOR')
  const base =
    sensors.find((device) => device.type === 'TH') || sensors[0] || (devices || [])[0] || null
  if (!base) {
    trendPoints.value = []
    return
  }
  try {
    const data = await fetchHistory({ deviceCode: base.code, interval: 60 })
    trendPoints.value = data?.points || []
  } catch {
    trendPoints.value = []
  }
}

/** 载入实时环境数据，并串行刷新环比与曲线 */
async function loadRealtime() {
  realtimeError.value = false
  realtimeLoading.value = true
  try {
    const params = {}
    if (applied.value.plotId) {
      params.plotId = applied.value.plotId
    }
    const data = await fetchRealtime(params)
    realtime.value = data
    await loadTrend(data?.devices)
    // 地块或类型变化后原设备可能不在当前范围内，重新挑一台
    const nextCode = pickChartDevice()
    await loadHistory(nextCode)
  } catch (err) {
    realtime.value = null
    trendPoints.value = []
    history.value = { points: [] }
    if (err?.code !== 40401) {
      realtimeError.value = true
    }
  } finally {
    realtimeLoading.value = false
  }
}

/** 载入设备状态表（沿用当前页码，重置到第 1 页由 search 负责） */
async function loadDevices() {
  deviceError.value = false
  deviceTable.filters.plotId = applied.value.plotId
  deviceTable.filters.type = applied.value.deviceType
  try {
    await deviceTable.loadData()
  } catch (err) {
    if (err?.code !== 40401) {
      deviceError.value = true
    }
  }
}

/** 载入待处置告警 */
async function loadAlarms() {
  alarmError.value = false
  try {
    await alarmTable.loadData()
  } catch (err) {
    if (err?.code !== 40401) {
      alarmError.value = true
    }
  }
}

/**
 * 查询：把搜索栏条件复制为已生效条件，并刷新实时/曲线/设备表。
 * @param {Object} [payload] 搜索栏抛出的条件快照
 */
function handleSearch(payload) {
  const source = payload || query.value
  applied.value = {
    plotId: source.plotId || '',
    deviceType: source.deviceType || '',
    range: Array.isArray(source.range) ? [...source.range] : []
  }
  loadRealtime()
  deviceTable.filters.plotId = applied.value.plotId
  deviceTable.filters.type = applied.value.deviceType
  deviceTable.search().catch((err) => {
    if (err?.code !== 40401) {
      deviceError.value = true
    }
  })
}

/** 重置：清空搜索条件并回到默认视图 */
function handleReset() {
  query.value = { plotId: '', deviceType: '', range: [] }
  handleSearch(query.value)
}

/**
 * 表格翻页：更新分页状态后重新取数。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handleDevicePageChange(payload) {
  try {
    await deviceTable.onPageChange(payload)
  } catch {
    deviceError.value = true
  }
}

/**
 * 表格切换每页条数。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handleDeviceSizeChange(payload) {
  try {
    await deviceTable.onSizeChange(payload)
  } catch {
    deviceError.value = true
  }
}

/**
 * 告警表翻页。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handleAlarmPageChange(payload) {
  try {
    await alarmTable.onPageChange(payload)
  } catch {
    alarmError.value = true
  }
}

/**
 * 告警表切换每页条数。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handleAlarmSizeChange(payload) {
  try {
    await alarmTable.onSizeChange(payload)
  } catch {
    alarmError.value = true
  }
}

/**
 * 点击「查看曲线」：把曲线切到该设备。
 * @param {Object} row 设备行
 */
function focusDevice(row) {
  loadHistory(row.code)
}

/** 重试实时数据（同时刷新曲线与设备表） */
function retryRealtime() {
  loadRealtime()
  loadDevices()
}

onMounted(() => {
  loadPlots()
  loadDeviceTypes()
  loadRealtime()
  loadDevices()
  loadAlarms()
})
</script>

<template>
  <div class="page-container env-monitor">
    <AgriPageHeader
      page-id="P002"
      title="环境数据监测"
      description="实时展示地块空气温湿度、土壤湿度与光照等环境指标，并按设备查看历史曲线。"
    >
      <template #extra>
        <span v-if="realtime?.updatedAt" class="env-monitor__updated">
          更新于 {{ realtime.updatedAt }}
        </span>
        <el-button :loading="realtimeLoading" @click="retryRealtime">刷新</el-button>
      </template>
    </AgriPageHeader>

    <!-- 指标卡：加载中显示骨架，失败显示可点击重试 -->
    <div v-if="realtimeError" class="env-monitor__error" @click="retryRealtime">
      加载失败，点击重试
    </div>
    <el-row v-else :gutter="16" class="env-monitor__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :trend="card.trend"
          :delta="card.delta"
          :tone="card.tone"
          :icon="card.icon"
          :loading="realtimeLoading"
        />
      </el-col>
    </el-row>

    <!-- 查询条件 -->
    <div class="agri-card env-monitor__section">
      <AgriSearchBar
        :model-value="query"
        :fields="searchFields"
        :loading="plotsLoading || typesLoading"
        @update:model-value="query = $event"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <!-- 温湿度曲线 -->
    <div class="agri-card env-monitor__section">
      <div class="env-monitor__section-head">
        <h3 class="env-monitor__section-title">温湿度趋势</h3>
        <span class="text-secondary">{{ chartSubtitle }}</span>
      </div>
      <div v-if="historyError" class="env-monitor__error" @click="loadHistory()">
        加载失败，点击重试
      </div>
      <AgriChart
        v-else
        :option="chartOption"
        :loading="historyLoading"
        :height="320"
        empty-text="所选设备暂无历史数据"
      />
    </div>

    <!-- 设备实时状态 -->
    <div class="agri-card env-monitor__section">
      <div class="env-monitor__section-head">
        <h3 class="env-monitor__section-title">设备实时状态</h3>
        <span class="text-secondary">共 {{ devicePagination.total }} 台设备</span>
      </div>
      <div v-if="deviceError" class="env-monitor__error" @click="loadDevices">
        加载失败，点击重试
      </div>
      <AgriTable
        v-else
        :columns="deviceColumns"
        :data="deviceList"
        :loading="deviceLoading"
        :total="devicePagination.total"
        :page="devicePagination.page"
        :size="devicePagination.size"
        :page-sizes="devicePageSizes"
        row-key="code"
        empty-text="暂无设备数据"
        @page-change="handleDevicePageChange"
        @size-change="handleDeviceSizeChange"
      >
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" @click="focusDevice(row)">查看曲线</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 最近待处置告警 -->
    <div class="agri-card env-monitor__section">
      <div class="env-monitor__section-head">
        <h3 class="env-monitor__section-title">最近告警</h3>
        <span class="text-secondary">待处置 {{ alarmPagination.total }} 条</span>
      </div>
      <div v-if="alarmError" class="env-monitor__error" @click="loadAlarms">加载失败，点击重试</div>
      <AgriTable
        v-else
        :columns="alarmColumns"
        :data="alarmList"
        :loading="alarmLoading"
        :total="alarmPagination.total"
        :page="alarmPagination.page"
        :size="alarmPagination.size"
        :page-sizes="alarmPageSizes"
        empty-text="暂无待处置告警"
        @page-change="handleAlarmPageChange"
        @size-change="handleAlarmSizeChange"
      >
        <template #level="{ row }">
          <AgriStatusTag :status="row.level" />
        </template>
      </AgriTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.env-monitor__updated {
  margin-right: $space-sm;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.env-monitor__stats {
  margin-bottom: $space-md;
}

// 指标卡在窄屏下换行时保留间距
.env-monitor__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.env-monitor__section {
  margin-bottom: $space-md;
}

.env-monitor__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.env-monitor__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

// 统一错误态：虚线框 + 主色文字，点击即重试
.env-monitor__error {
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
  .env-monitor__section-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
