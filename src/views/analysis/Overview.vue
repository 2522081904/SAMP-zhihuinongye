<script setup>
/**
 * P010 数据分析总览
 * 数据来源：A03 设备台账、A06 实时环境、A07 历史时序、A10 地块、A19 告警列表。
 * 时间基准：页面上的“现在”一律取接口返回时间（A06 updatedAt），
 *          不使用本地时钟；切换时间窗会重新请求 A07 与 A19 后在前端聚合。
 * 已知口径说明：mock 的时序窗口只覆盖 2026-11-10 起，窗口外日期在趋势图上留空断点。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { fetchAlarms, fetchDevices, fetchHistory, fetchPlots, fetchRealtime } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'

defineOptions({ name: 'AnalysisOverviewPage' })

const router = useRouter()

// 一天毫秒数
const DAY_MS = 24 * 60 * 60 * 1000

// 时间范围选项（天）
const RANGE_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 }
]

// 告警级别展示配置（与 A19 的 level 枚举对应）
const LEVEL_META = [
  { level: 'CRITICAL', name: '严重', color: '#f56c6c' },
  { level: 'MAJOR', name: '重要', color: '#e6a23c' },
  { level: 'MINOR', name: '次要', color: '#909399' }
]

const loading = ref(true)
const chartLoading = ref(false)
const error = ref(false)
const rangeDays = ref(14)

const devices = ref([])
const plots = ref([])
const realtimeList = ref([])
const alarmTotal = ref(0)
const levelCounts = ref({})
const trendPoints = ref([])
// 单台设备今日的采样点数（估算今日采集总量用）
const samplePerDevice = ref(0)
// 接口返回的当前时间，作为本页全部业务时间的基准
const baseNow = ref('')

const deviceTotal = computed(() => devices.value.length)
const onlineCount = computed(() => devices.value.filter((item) => item.status === 'ONLINE').length)
const offlineCount = computed(
  () => devices.value.filter((item) => item.status === 'OFFLINE').length
)
const faultCount = computed(() => devices.value.filter((item) => item.status === 'FAULT').length)
const abnormalCount = computed(() => deviceTotal.value - onlineCount.value)
const onlineRate = computed(() =>
  deviceTotal.value ? Math.round((onlineCount.value / deviceTotal.value) * 1000) / 10 : 0
)
// 今日采集条数：mock 未提供采集计数接口，按“单设备今日点数 × 设备总数”估算
const samplesToday = computed(() => samplePerDevice.value * deviceTotal.value)

/** 时间串转毫秒，兼容 Safari 对连字符日期的解析差异 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 数字补零 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 时间戳格式化为 YYYY-MM-DD（仅做日历换算，时间来源仍是接口） */
function formatDay(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 时间窗起点，返回 'YYYY-MM-DD 00:00:00' */
function windowStartText(days) {
  return `${formatDay(toTimestamp(baseNow.value) - (days - 1) * DAY_MS)} 00:00:00`
}

/** 趋势日期轴：窗口内每天一个点，无数据为 null 形成断点 */
const trendDays = computed(() => {
  if (!baseNow.value) {
    return []
  }
  const buckets = new Map()
  trendPoints.value.forEach((point) => {
    const day = String(point.time || '').slice(0, 10)
    if (!day) {
      return
    }
    const bucket = buckets.get(day) || { temperature: 0, humidity: 0, count: 0 }
    bucket.temperature += Number(point.temperature) || 0
    bucket.humidity += Number(point.humidity) || 0
    bucket.count += 1
    buckets.set(day, bucket)
  })
  const endMs = toTimestamp(baseNow.value)
  const days = []
  for (let offset = rangeDays.value - 1; offset >= 0; offset -= 1) {
    const day = formatDay(endMs - offset * DAY_MS)
    const bucket = buckets.get(day)
    days.push({
      day,
      label: day.slice(5),
      temperature: bucket ? Math.round((bucket.temperature / bucket.count) * 10) / 10 : null,
      humidity: bucket ? Math.round(bucket.humidity / bucket.count) : null
    })
  }
  return days
})

// 有数据的日期数，用于卡片副标题与验证
const filledDays = computed(
  () => trendDays.value.filter((item) => item.temperature !== null).length
)

/** 各地块当前平均温度（按温度降序，供柱状图与指标使用） */
const temperatureRanking = computed(() =>
  realtimeList.value
    .map((item) => ({
      name: item.plotName,
      value: Number(item.metrics?.temperature) || 0
    }))
    .sort((left, right) => right.value - left.value)
)

/** 土壤含水率最低的地块 */
const driestPlot = computed(() => {
  const rows = realtimeList.value.map((item) => ({
    name: item.plotName,
    value: Number(item.metrics?.soilMoisture) || 0
  }))
  return rows.sort((left, right) => left.value - right.value)[0] || null
})

/** 近 14 天环境趋势：温度/湿度双轴折线 */
const trendOption = computed(() => ({
  grid: { left: 48, right: 48, top: 44, bottom: 30 },
  tooltip: { trigger: 'axis' },
  legend: { right: 0, top: 0, itemWidth: 12, itemHeight: 8 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trendDays.value.map((item) => item.label),
    axisLabel: { fontSize: 11, interval: rangeDays.value > 14 ? 2 : 0 }
  },
  yAxis: [
    {
      type: 'value',
      name: '温度 ℃',
      scale: true,
      nameTextStyle: { fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } }
    },
    {
      type: 'value',
      name: '湿度 %',
      scale: true,
      nameTextStyle: { fontSize: 11 },
      splitLine: { show: false }
    }
  ],
  series: [
    {
      name: '平均温度',
      type: 'line',
      smooth: true,
      showSymbol: false,
      connectNulls: false,
      data: trendDays.value.map((item) => item.temperature),
      itemStyle: { color: '#2e7d58' },
      areaStyle: { opacity: 0.12, color: '#2e7d58' }
    },
    {
      name: '平均湿度',
      type: 'line',
      smooth: true,
      showSymbol: false,
      connectNulls: false,
      yAxisIndex: 1,
      data: trendDays.value.map((item) => item.humidity),
      itemStyle: { color: '#3a8fd0' }
    }
  ]
}))

/** 告警级别分布：环形饼图 */
const levelOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
  legend: { bottom: 0, itemWidth: 10, itemHeight: 8 },
  series: [
    {
      name: '告警级别',
      type: 'pie',
      radius: ['42%', '66%'],
      center: ['50%', '44%'],
      // 卡片宽度有限，标签放扇区内并显示条数，避免外侧标签被裁切
      label: { position: 'inside', formatter: '{b}\n{c} 条', fontSize: 11, color: '#fff' },
      labelLine: { show: false },
      data: LEVEL_META.map((item) => ({
        name: item.name,
        value: levelCounts.value[item.level] || 0,
        itemStyle: { color: item.color }
      }))
    }
  ]
}))

/** 各地块平均温度对比：柱状图 */
const temperatureOption = computed(() => ({
  grid: { left: 44, right: 16, top: 28, bottom: 58 },
  tooltip: { trigger: 'axis', valueFormatter: (value) => `${value} ℃` },
  xAxis: {
    type: 'category',
    data: temperatureRanking.value.map((item) => item.name),
    axisLabel: { fontSize: 11, interval: 0, rotate: 22 }
  },
  yAxis: {
    type: 'value',
    name: '℃',
    scale: true,
    nameTextStyle: { fontSize: 11 },
    splitLine: { lineStyle: { type: 'dashed' } }
  },
  series: [
    {
      name: '平均温度',
      type: 'bar',
      barWidth: '46%',
      data: temperatureRanking.value.map((item) => item.value),
      itemStyle: { color: '#2e7d58', borderRadius: [4, 4, 0, 0] }
    }
  ]
}))

/** 设备在线率：环形仪表 */
const onlineOption = computed(() => ({
  series: [
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      radius: '80%',
      pointer: { show: false },
      progress: { show: true, roundCap: true, width: 14, itemStyle: { color: '#2e7d58' } },
      axisLine: { lineStyle: { width: 14, color: [[1, '#eef2ef']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      anchor: { show: false },
      title: { show: true, offsetCenter: [0, '38%'], fontSize: 12, color: '#8b95a1' },
      detail: {
        fontSize: 26,
        offsetCenter: [0, '-2%'],
        color: '#1f2d3d',
        formatter: '{value}%'
      },
      data: [{ value: onlineRate.value, name: '在线率' }]
    }
  ]
}))

/** 加载窗口内的时序数据（窗口外日期由 trendDays 留空） */
async function loadTrend() {
  const sensor = devices.value[0]
  if (!sensor || !baseNow.value) {
    trendPoints.value = []
    return
  }
  const data = await fetchHistory({
    deviceCode: sensor.code,
    from: windowStartText(rangeDays.value),
    to: baseNow.value,
    interval: 240
  })
  trendPoints.value = data?.points || []
}

/** 加载窗口内的告警数量与级别分布（A19 按 from/to 过滤后取 total） */
async function loadAlarms() {
  const range = { from: windowStartText(rangeDays.value), to: baseNow.value, size: 1 }
  const [all, critical, major, minor] = await Promise.all([
    fetchAlarms(range),
    fetchAlarms({ ...range, level: 'CRITICAL' }),
    fetchAlarms({ ...range, level: 'MAJOR' }),
    fetchAlarms({ ...range, level: 'MINOR' })
  ])
  alarmTotal.value = all?.total || 0
  levelCounts.value = {
    CRITICAL: critical?.total || 0,
    MAJOR: major?.total || 0,
    MINOR: minor?.total || 0
  }
}

/** 估算今日采集条数：取首台设备今日点数作为单设备采样次数 */
async function loadSampleEstimate() {
  const sensor = devices.value[0]
  if (!sensor || !baseNow.value) {
    samplePerDevice.value = 0
    return
  }
  const data = await fetchHistory({
    deviceCode: sensor.code,
    from: `${String(baseNow.value).slice(0, 10)} 00:00:00`,
    to: baseNow.value,
    interval: 30
  })
  samplePerDevice.value = data?.total || 0
}

/** 首屏加载：设备 → 地块 → 各地块实时 → 时序/告警/采样估算 */
async function loadBase() {
  loading.value = true
  error.value = false
  try {
    const [deviceData, plotData] = await Promise.all([
      fetchDevices({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 50 })
    ])
    devices.value = deviceData?.list || []
    plots.value = plotData?.list || []
    const realtime = await Promise.all(
      plots.value.map((plot) => fetchRealtime({ plotId: plot.id }).catch(() => null))
    )
    realtimeList.value = realtime.filter(Boolean)
    baseNow.value = realtimeList.value[0]?.updatedAt || ''
    if (!baseNow.value) {
      error.value = true
      return
    }
    await Promise.all([loadTrend(), loadAlarms(), loadSampleEstimate()])
  } catch (err) {
    error.value = err?.code !== 40401
  } finally {
    loading.value = false
  }
}

/** 切换时间窗：重新请求 A07 与 A19 后聚合 */
async function handleRangeChange() {
  chartLoading.value = true
  try {
    await Promise.all([loadTrend(), loadAlarms()])
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('时间范围切换失败，请稍后重试')
    }
  } finally {
    chartLoading.value = false
  }
}

/** 跳转到对应明细页 */
function goDetail(path) {
  router.push(path)
}

onMounted(loadBase)
</script>

<template>
  <div class="page-container analysis-overview">
    <AgriPageHeader
      page-id="P010"
      title="数据分析总览"
      description="汇总环境监测、告警与设备在线情况，按时间窗重新聚合关键指标。"
    >
      <template #extra>
        <el-radio-group v-model="rangeDays" size="small" @change="handleRangeChange">
          <el-radio-button v-for="item in RANGE_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </template>
    </AgriPageHeader>

    <div v-if="error" class="analysis-overview__error" @click="loadBase">
      数据加载失败，点击重试
    </div>

    <section class="analysis-overview__stats">
      <AgriStatCard
        label="监测设备数"
        :value="deviceTotal"
        unit="台"
        icon="Cpu"
        tone="brand"
        :loading="loading"
      />
      <AgriStatCard
        label="今日采集条数"
        :value="samplesToday"
        unit="条"
        icon="DataLine"
        tone="brand"
        :loading="loading"
      />
      <AgriStatCard
        label="近窗口告警数"
        :value="alarmTotal"
        unit="条"
        icon="WarningFilled"
        tone="danger"
        :loading="loading"
      />
      <AgriStatCard
        label="设备在线率"
        :value="onlineRate"
        unit="%"
        icon="Link"
        tone="ok"
        :loading="loading"
      />
    </section>

    <section class="analysis-overview__main">
      <div class="agri-card analysis-overview__trend">
        <div class="analysis-overview__trend-head">
          <h3 class="analysis-overview__card-title">环境趋势（近 {{ rangeDays }} 天）</h3>
          <span
            class="analysis-overview__trend-meta"
            :data-days="trendDays.length"
            :data-filled="filledDays"
          >
            共 {{ trendDays.length }} 天 · 有数据 {{ filledDays }} 天
          </span>
        </div>
        <AgriChart
          :option="trendOption"
          :loading="chartLoading || loading"
          :empty="!trendDays.length"
          empty-text="所选时间窗内暂无环境时序数据"
          height="300px"
        />
        <p class="analysis-overview__note">
          数据来源 A07 历史时序（4 小时聚合）。mock 时序窗口自 2026-11-10 起，
          窗口外日期显示为空断点，属数据覆盖范围限制。
        </p>
      </div>

      <div class="agri-card analysis-overview__metrics">
        <h3 class="analysis-overview__card-title">重点指标</h3>
        <ul class="analysis-overview__metric-list">
          <li class="analysis-overview__metric-item">
            <div class="analysis-overview__metric-main">
              <span class="analysis-overview__metric-label">当前最高温地块</span>
              <span class="analysis-overview__metric-value">
                {{ temperatureRanking[0]?.name || '-' }}
                <em>{{ temperatureRanking[0]?.value ?? '-' }} ℃</em>
              </span>
            </div>
            <el-button link type="primary" @click="goDetail('/iot/env')">查看详情</el-button>
          </li>
          <li class="analysis-overview__metric-item">
            <div class="analysis-overview__metric-main">
              <span class="analysis-overview__metric-label">最低土壤含水率</span>
              <span class="analysis-overview__metric-value">
                {{ driestPlot?.name || '-' }}
                <em>{{ driestPlot?.value ?? '-' }} %</em>
              </span>
            </div>
            <el-button link type="primary" @click="goDetail('/iot/env')">查看详情</el-button>
          </li>
          <li class="analysis-overview__metric-item">
            <div class="analysis-overview__metric-main">
              <span class="analysis-overview__metric-label">异常设备数</span>
              <span class="analysis-overview__metric-value">
                离线 {{ offlineCount }} 台 · 故障 {{ faultCount }} 台
              </span>
            </div>
            <el-button link type="primary" @click="goDetail('/iot/devices')">查看详情</el-button>
          </li>
        </ul>
        <p class="analysis-overview__note">
          在线 {{ onlineCount }} 台 / 共 {{ deviceTotal }} 台，异常 {{ abnormalCount }} 台。
        </p>
      </div>
    </section>

    <section class="analysis-overview__charts">
      <div class="agri-card analysis-overview__chart-card">
        <h3 class="analysis-overview__card-title">告警级别分布</h3>
        <AgriChart
          :option="levelOption"
          :loading="chartLoading || loading"
          :empty="!alarmTotal"
          empty-text="所选时间窗内暂无告警"
          height="260px"
        />
      </div>
      <div class="agri-card analysis-overview__chart-card">
        <h3 class="analysis-overview__card-title">各地块平均温度</h3>
        <AgriChart
          :option="temperatureOption"
          :loading="loading"
          :empty="!temperatureRanking.length"
          empty-text="暂无地块实时温度数据"
          height="260px"
        />
      </div>
      <div class="agri-card analysis-overview__chart-card">
        <h3 class="analysis-overview__card-title">设备在线率</h3>
        <AgriChart
          :option="onlineOption"
          :loading="loading"
          :empty="!deviceTotal"
          empty-text="暂无设备数据"
          height="260px"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.analysis-overview__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.analysis-overview__main {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.analysis-overview__trend {
  padding: 16px;
}

.analysis-overview__trend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.analysis-overview__trend-meta {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.analysis-overview__metrics {
  padding: 16px;
}

.analysis-overview__card-title {
  margin: 0 0 12px;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.analysis-overview__metric-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.analysis-overview__metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px dashed $border-color;

  &:last-child {
    border-bottom: none;
  }
}

.analysis-overview__metric-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.analysis-overview__metric-label {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.analysis-overview__metric-value {
  font-size: $font-size-sm;
  color: $text-primary;

  em {
    margin-left: 4px;
    font-style: normal;
    font-weight: 600;
    color: $primary-color;
  }
}

.analysis-overview__charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.analysis-overview__chart-card {
  padding: 16px;
}

.analysis-overview__note {
  margin: 12px 0 0;
  font-size: $font-size-xs;
  line-height: 1.7;
  color: $text-secondary;
}

.analysis-overview__error {
  margin-bottom: 16px;
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}

@media (max-width: 1280px) {
  .analysis-overview__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-overview__main {
    grid-template-columns: minmax(0, 1fr);
  }

  .analysis-overview__charts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
