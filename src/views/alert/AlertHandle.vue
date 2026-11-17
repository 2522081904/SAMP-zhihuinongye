<script setup>
/**
 * P026 告警处置与统计分析
 * 职责：按 7/14/30 天窗口重新拉取 A19 并前端聚合告警趋势、设备 Top10、
 *      级别占比与处置效率排行；卡片按“本月”口径统计，A22 周报仅作口径说明。
 */
import { computed, onMounted, ref } from 'vue'

import { fetchAlarms, fetchRealtime, fetchReportDetail, fetchReports } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'AlertHandlePage' })

const LEVELS = [
  { key: 'CRITICAL', name: '紧急', color: '#c0392b' },
  { key: 'MAJOR', name: '重要', color: '#e67e22' },
  { key: 'MINOR', name: '一般', color: '#2e7d58' },
  { key: 'INFO', name: '提示', color: '#8b95a1' }
]

const rangeDays = ref(14)
const nowText = ref('')
const windowRows = ref([])
const windowLoading = ref(false)
const windowError = ref(false)
const monthRows = ref([])
const monthLoading = ref(false)
const reportMeta = ref(null)

const columns = [
  { prop: 'deviceName', label: '设备 / 地块', minWidth: 190, slot: 'device' },
  { prop: 'total', label: '告警数', width: 100 },
  { prop: 'handled', label: '已处置', width: 100 },
  { prop: 'avgMinutes', label: '平均时长', width: 120, slot: 'avg' },
  { prop: 'rate', label: '处置率', minWidth: 200, slot: 'rate' }
]

const monthStats = computed(() => {
  const rows = monthRows.value
  const total = rows.length
  const handled = rows.filter((row) => row.status === 'RESOLVED' || row.status === 'IGNORED')
  const ignored = rows.filter((row) => row.status === 'IGNORED').length
  const durations = handled
    .map((row) => toTimestamp(row.handledAt) - toTimestamp(row.createdAt))
    .filter((ms) => ms > 0)
  const avgMs = durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : 0
  return {
    total,
    handledRate: total ? Math.round((handled.length / total) * 1000) / 10 : 0,
    avgMinutes: Math.round((avgMs / 60000) * 10) / 10,
    falseRate: total ? Math.round((ignored / total) * 1000) / 10 : 0
  }
})

const statCards = computed(() => [
  {
    label: '本月告警总数',
    value: monthStats.value.total,
    unit: '条',
    icon: 'Bell',
    tone: 'brand'
  },
  {
    label: '处置率',
    value: monthStats.value.handledRate,
    unit: '%',
    icon: 'CircleCheck',
    tone: 'ok'
  },
  {
    label: '平均处置时长',
    value: monthStats.value.avgMinutes,
    unit: '分钟',
    icon: 'Timer',
    tone: 'warn'
  },
  {
    label: '误报率',
    value: monthStats.value.falseRate,
    unit: '%',
    icon: 'Warning',
    tone: 'danger'
  }
])

const trendDays = computed(() => {
  const end = toTimestamp(nowText.value) || toTimestamp(windowRows.value[0]?.createdAt)
  if (!end) {
    const keys = [...new Set(windowRows.value.map((row) => String(row.createdAt).slice(0, 10)))]
    return keys
      .sort()
      .slice(-rangeDays.value)
      .map((key) => ({ key, label: key.slice(5) }))
  }
  const days = []
  for (let index = rangeDays.value - 1; index >= 0; index -= 1) {
    const date = new Date(end)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - index)
    const key = formatDateKey(date)
    days.push({ key, label: key.slice(5) })
  }
  return days
})

const trendBucket = computed(() => {
  const bucket = new Map()
  trendDays.value.forEach((day) => {
    const row = { CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 }
    bucket.set(day.key, row)
  })
  windowRows.value.forEach((row) => {
    const key = String(row.createdAt || '').slice(0, 10)
    const target = bucket.get(key)
    if (target && target[row.level] !== undefined) {
      target[row.level] += 1
    }
  })
  return bucket
})

const trendOption = computed(() => {
  if (!trendDays.value.length) {
    return {}
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: LEVELS.map((level) => level.name), top: 0, icon: 'roundRect' },
    grid: { left: 44, right: 24, top: 46, bottom: 30 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendDays.value.map((day) => day.label),
      axisLine: { lineStyle: { color: '#dcdfe6' } },
      axisLabel: { color: '#8b95a1' }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#8b95a1' },
      splitLine: { lineStyle: { color: '#f0f2f5' } }
    },
    series: LEVELS.map((level) => ({
      name: level.name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      itemStyle: { color: level.color },
      lineStyle: { width: 2 },
      data: trendDays.value.map((day) => trendBucket.value.get(day.key)?.[level.key] || 0)
    }))
  }
})

const levelDistribution = computed(() =>
  LEVELS.map((level) => ({
    name: level.name,
    value: windowRows.value.filter((row) => row.level === level.key).length,
    itemStyle: { color: level.color }
  })).filter((item) => item.value > 0)
)

const pieOption = computed(() => {
  if (!levelDistribution.value.length) {
    return {}
  }
  return {
    tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        name: '告警级别',
        type: 'pie',
        radius: ['42%', '66%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { formatter: '{b}\n{c} 条' },
        data: levelDistribution.value
      }
    ]
  }
})

const topDevices = computed(() => {
  const bucket = new Map()
  windowRows.value.forEach((row) => {
    const key = row.deviceCode || row.deviceName || '-'
    bucket.set(key, (bucket.get(key) || 0) + 1)
  })
  return [...bucket.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10)
})

const barOption = computed(() => {
  if (!topDevices.value.length) {
    return {}
  }
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 44, right: 20, top: 24, bottom: 86 },
    xAxis: {
      type: 'category',
      data: topDevices.value.map((item) => item.name),
      axisLabel: { rotate: 32, interval: 0, color: '#8b95a1', width: 96, overflow: 'truncate' },
      axisLine: { lineStyle: { color: '#dcdfe6' } }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#8b95a1' },
      splitLine: { lineStyle: { color: '#f0f2f5' } }
    },
    series: [
      {
        name: '告警数',
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { color: '#2e7d58', borderRadius: [4, 4, 0, 0] },
        data: topDevices.value.map((item) => item.value)
      }
    ]
  }
})

const rankingRows = computed(() => {
  const bucket = new Map()
  windowRows.value.forEach((row) => {
    const key = row.deviceCode || row.deviceName || '-'
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        deviceName: row.deviceName || '-',
        plotName: row.plotName || '-',
        total: 0,
        handled: 0,
        durations: []
      })
    }
    const item = bucket.get(key)
    item.total += 1
    if (row.status === 'RESOLVED' || row.status === 'IGNORED') {
      item.handled += 1
      const duration = toTimestamp(row.handledAt) - toTimestamp(row.createdAt)
      if (duration > 0) {
        item.durations.push(duration)
      }
    }
  })
  return [...bucket.values()]
    .map((item) => ({
      key: item.key,
      deviceName: item.deviceName,
      plotName: item.plotName,
      total: item.total,
      handled: item.handled,
      avgMinutes: item.durations.length
        ? Math.round(
            (item.durations.reduce((sum, ms) => sum + ms, 0) / item.durations.length / 60000) * 10
          ) / 10
        : 0,
      rate: item.total ? Math.round((item.handled / item.total) * 1000) / 10 : 0
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 10)
})

/** 时间串转毫秒，兼容 Safari 的连字符问题 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** Date → yyyy-MM-dd */
function formatDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Date → yyyy-MM-dd HH:mm:ss */
function formatDateTime(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}:${second}`
}

/**
 * 窗口起点：以接口返回的当前时间回推，含当天。
 * @param {number} days 天数
 * @returns {string} yyyy-MM-dd HH:mm:ss，无法确定时返回空串
 */
function rangeStart(days) {
  const end = toTimestamp(nowText.value)
  if (!end) {
    return ''
  }
  const date = new Date(end)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (days - 1))
  return formatDateTime(date)
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

/** 本月卡片数据：从月初重新拉取 A19 */
async function loadMonthRows() {
  monthLoading.value = true
  try {
    const params = { page: 1, size: 100 }
    if (nowText.value) {
      params.from = `${nowText.value.slice(0, 7)}-01 00:00:00`
      params.to = nowText.value
    }
    const data = await fetchAlarms(params)
    monthRows.value = data?.list || []
  } catch {
    monthRows.value = []
  } finally {
    monthLoading.value = false
  }
}

/** 图表与排行：按当前窗口真实重拉 A19 后聚合 */
async function loadWindow() {
  windowLoading.value = true
  windowError.value = false
  try {
    const params = { page: 1, size: 100 }
    const from = rangeStart(rangeDays.value)
    if (from) {
      params.from = from
    }
    if (nowText.value) {
      params.to = nowText.value
    }
    const data = await fetchAlarms(params)
    windowRows.value = data?.list || []
  } catch (err) {
    windowRows.value = []
    if (err?.code !== 40401) {
      windowError.value = true
    }
  } finally {
    windowLoading.value = false
  }
}

/** A22 告警周报：仅用于页面口径说明 */
async function loadReportMeta() {
  try {
    const listData = await fetchReports({ page: 1, size: 20, type: 'ALARM' })
    const report = (listData?.list || [])[0]
    if (!report) {
      return
    }
    const detail = await fetchReportDetail(report.id)
    reportMeta.value = {
      reportNo: detail?.reportNo || report.reportNo,
      name: detail?.name || report.name,
      generatedAt: detail?.generatedAt || '',
      total: detail?.summary?.total ?? ''
    }
  } catch {
    reportMeta.value = null
  }
}

/** 处置率进度条颜色 */
function progressColor(rate) {
  if (rate >= 80) {
    return '#2e7d58'
  }
  if (rate >= 50) {
    return '#e6a23c'
  }
  return '#f56c6c'
}

onMounted(async () => {
  await loadNow()
  await Promise.all([loadMonthRows(), loadWindow(), loadReportMeta()])
})
</script>

<template>
  <div class="page-container alert-analysis">
    <AgriPageHeader
      page-id="P026"
      title="告警处置与统计"
      description="从告警趋势、设备分布与处置效率三个维度复盘告警处置情况。"
    >
      <template #extra>
        <el-radio-group v-model="rangeDays" size="small" @change="loadWindow">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
      </template>
    </AgriPageHeader>

    <div v-if="reportMeta" class="alert-analysis__source">
      A22 告警周报：{{ reportMeta.name }}（{{ reportMeta.reportNo }}）生成于
      {{ reportMeta.generatedAt || '-' }}，共 {{ reportMeta.total }} 条告警。
    </div>

    <el-row :gutter="16" class="alert-analysis__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
          :loading="monthLoading"
        />
      </el-col>
    </el-row>

    <div v-if="windowError" class="alert-analysis__error" @click="loadWindow">
      加载失败，点击重试
    </div>

    <div class="agri-card alert-analysis__chart-card">
      <div class="alert-analysis__chart-head">
        <h3 class="alert-analysis__chart-title">告警趋势（近 {{ rangeDays }} 天）</h3>
        <span class="text-secondary">按级别拆分，数据来自 A19 实时聚合</span>
      </div>
      <AgriChart
        :option="trendOption"
        :loading="windowLoading"
        :height="320"
        :empty="!windowRows.length"
        empty-text="当前窗口暂无告警数据"
      />
    </div>

    <el-row :gutter="16" class="alert-analysis__charts">
      <el-col :xs="24" :md="12">
        <div class="agri-card alert-analysis__chart-card">
          <div class="alert-analysis__chart-head">
            <h3 class="alert-analysis__chart-title">告警设备 Top 10</h3>
            <span class="text-secondary">按告警条数降序</span>
          </div>
          <AgriChart
            :option="barOption"
            :loading="windowLoading"
            :height="320"
            :empty="!windowRows.length"
            empty-text="当前窗口暂无设备告警"
          />
        </div>
      </el-col>
      <el-col :xs="24" :md="12">
        <div class="agri-card alert-analysis__chart-card">
          <div class="alert-analysis__chart-head">
            <h3 class="alert-analysis__chart-title">告警级别占比</h3>
            <span class="text-secondary">按级别统计当前窗口</span>
          </div>
          <AgriChart
            :option="pieOption"
            :loading="windowLoading"
            :height="320"
            :empty="!windowRows.length"
            empty-text="当前窗口暂无级别分布"
          />
        </div>
      </el-col>
    </el-row>

    <div class="agri-card">
      <div class="alert-analysis__chart-head">
        <h3 class="alert-analysis__chart-title">处置效率排行</h3>
        <span class="text-secondary">按告警数取前 10 台设备 / 地块</span>
      </div>
      <AgriTable
        :columns="columns"
        :data="rankingRows"
        :loading="windowLoading"
        :show-pagination="false"
        row-key="key"
        empty-text="当前窗口暂无处置数据"
      >
        <template #device="{ row }">
          <div class="alert-analysis__device">{{ row.deviceName }}</div>
          <div class="alert-analysis__sub">{{ row.plotName }}</div>
        </template>
        <template #avg="{ row }">
          {{ row.avgMinutes ? `${row.avgMinutes} 分钟` : '-' }}
        </template>
        <template #rate="{ row }">
          <div class="alert-analysis__rate">
            <el-progress
              :percentage="row.rate"
              :stroke-width="8"
              :color="progressColor(row.rate)"
              :show-text="false"
            />
            <span class="alert-analysis__rate-text">{{ row.rate }}%</span>
          </div>
        </template>
      </AgriTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.alert-analysis__source {
  margin-bottom: 12px;
  padding: 8px 12px;
  font-size: $font-size-xs;
  line-height: 1.7;
  color: $text-secondary;
  background: rgba(46, 125, 88, 0.08);
  border-radius: $radius-md;
}

.alert-analysis__stats {
  margin-bottom: 16px;
}

.alert-analysis__charts {
  margin-bottom: 0;
}

.alert-analysis__chart-card {
  margin-bottom: 16px;
}

.alert-analysis__chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.alert-analysis__chart-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.alert-analysis__device {
  font-size: $font-size-sm;
  color: $text-primary;
}

.alert-analysis__sub {
  margin-top: 2px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.alert-analysis__rate {
  display: flex;
  align-items: center;
  gap: 8px;
}

.alert-analysis__rate :deep(.el-progress) {
  flex: 1;
}

.alert-analysis__rate-text {
  flex-shrink: 0;
  width: 46px;
  font-size: $font-size-xs;
  color: $text-secondary;
  text-align: right;
}

.alert-analysis__error {
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
