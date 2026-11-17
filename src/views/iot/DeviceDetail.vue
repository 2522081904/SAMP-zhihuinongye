<script setup>
/**
 * P003 设备详情
 * 职责：以设备编码（route.query.code）为主键，聚合 A03 设备详情、A06 实时环境、
 *      A07 历史时序、A19 告警列表与 A05 指令回执，形成设备级单页视图。
 * 交互约定：编码缺失或设备不存在（40401）时给「设备不存在」空态与返回入口，不白屏；
 *          其余错误在卡片内以「加载失败，点击重试」呈现。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { fetchAlarms, fetchCommand, fetchDeviceDetail, fetchHistory, fetchRealtime } from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'DeviceDetailPage' })

const route = useRoute()
const router = useRouter()

// 设备编码来自地址栏，非法值统一按「未提供」处理
const code = computed(() => {
  const value = route.query.code
  return typeof value === 'string' ? value.trim() : ''
})

// 详情状态：missing=无编码或设备不存在，failed=接口异常
const device = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

// 实时数据（A06）中该设备的最新指标
const realtimeDevice = ref(null)
const realtimeUpdatedAt = ref('')

// 曲线状态
const history = ref({ points: [] })
const historyLoading = ref(false)
const historyError = ref(false)
const historyRange = ref('24h')
const customRange = ref([])
const interval = ref(60)

// 告警记录
const alarmList = ref([])
const alarmLoading = ref(false)
const alarmError = ref(false)
const alarmPagination = reactive({ page: 1, size: 5, total: 0 })

// 指令记录（来自 A03 详情，按需查询 A05 回执）
const commands = ref([])

const activeTab = ref('overview')

const intervalOptions = [
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '2 小时', value: 120 }
]

const rangeOptions = [
  { label: '近 24 小时', value: '24h' },
  { label: '近 7 天', value: '7d' },
  { label: '自定义', value: 'custom' }
]

// 属性表：设备台账全字段，便于运维核对
const attributes = computed(() => {
  const item = device.value
  if (!item) {
    return []
  }
  return [
    { label: '设备编号', value: item.code },
    { label: '设备名称', value: item.name },
    { label: '设备类型', value: item.typeName },
    { label: '设备类别', value: item.categoryName },
    { label: '所属地块', value: item.plotName },
    { label: '种植作物', value: item.crop },
    { label: '固件版本', value: item.firmware },
    { label: '安装日期', value: item.installDate },
    { label: '信号强度', value: item.signal },
    { label: '厂商', value: item.manufacturer },
    { label: '内网 IP', value: item.ip },
    { label: '最后上报', value: item.lastSeen },
    { label: '最近维护', value: item.lastMaintainAt }
  ]
})

// 指标卡：优先取 A06 实时值，缺失时回落到详情里的最近一次采样
const metricSource = computed(() => realtimeDevice.value?.metrics || device.value?.metrics || {})

const statCards = computed(() => {
  const metrics = metricSource.value
  return [
    {
      label: '空气温度',
      value: formatMetric(metrics.temperature, 1),
      unit: '℃',
      icon: 'Sunny',
      tone: 'brand'
    },
    {
      label: '空气湿度',
      value: formatMetric(metrics.humidity, 0),
      unit: '%',
      icon: 'Cloudy',
      tone: 'ok'
    },
    {
      label: '光照强度',
      value: formatMetric(metrics.light, 0),
      unit: 'lux',
      icon: 'Odometer',
      tone: 'warn'
    },
    {
      label: '土壤湿度',
      value: formatMetric(metrics.soilMoisture, 0),
      unit: '%',
      icon: 'Pouring',
      tone: 'brand'
    }
  ]
})

// 曲线：温度走左轴，湿度走右轴，光照单独一条右轴（量级差大，避免挤平）
const chartOption = computed(() => {
  const points = history.value?.points || []
  if (!points.length) {
    return {}
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['空气温度', '空气湿度', '光照强度'], top: 0, right: 0 },
    grid: { left: 8, right: 8, bottom: 8, top: 44, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((point) => String(point.time || '').slice(5, 16)),
      axisLabel: { hideOverlap: true }
    },
    yAxis: [
      { type: 'value', name: '温度(℃)', splitLine: { lineStyle: { type: 'dashed' } } },
      { type: 'value', name: '湿度(%)', splitLine: { show: false } },
      {
        type: 'value',
        name: '光照(lux)',
        position: 'right',
        offset: 52,
        splitLine: { show: false }
      }
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
      },
      {
        name: '光照强度',
        type: 'line',
        smooth: true,
        showSymbol: false,
        yAxisIndex: 2,
        data: points.map((point) => point.light)
      }
    ]
  }
})

// 曲线副标题：说明当前窗口与采样间隔
const chartSubtitle = computed(() => {
  const total = history.value?.total ?? history.value?.points?.length ?? 0
  const from = history.value?.from || ''
  const to = history.value?.to || ''
  if (!total) {
    return ''
  }
  return `${from} 至 ${to} · 共 ${total} 个采样点 · 间隔 ${interval.value} 分钟`
})

const alarmColumns = [
  { prop: 'level', label: '级别', width: 90, slot: 'level' },
  { prop: 'content', label: '告警内容', minWidth: 260, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 110, slot: 'status' },
  { prop: 'createdAt', label: '发生时间', minWidth: 170 }
]

const commandColumns = [
  { prop: 'requestId', label: '指令号', minWidth: 190, showOverflowTooltip: true },
  { prop: 'actionName', label: '动作', minWidth: 120 },
  { prop: 'status', label: '状态', width: 110, slot: 'status' },
  { prop: 'createdAt', label: '下发时间', minWidth: 170 },
  { prop: 'operator', label: '操作人', width: 100 },
  { prop: 'result', label: '执行结果', minWidth: 180, showOverflowTooltip: true }
]

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
 * 把 'yyyy-MM-dd HH:mm:ss' 转成毫秒时间戳。
 * 百分号替换成斜杠是为了兼容各浏览器对带空格日期串的解析差异。
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

/** 载入设备详情，并串联实时数据与曲线 */
async function loadDetail() {
  detailError.value = ''
  device.value = null
  realtimeDevice.value = null
  commands.value = []
  if (!code.value) {
    detailError.value = 'missing'
    return
  }
  detailLoading.value = true
  try {
    const data = await fetchDeviceDetail(code.value)
    device.value = data
    commands.value = (data?.recentCommands || []).map((item) => ({ ...item, querying: false }))
    await Promise.all([loadRealtime(), loadHistory()])
  } catch (err) {
    // 40401 表示设备不存在：走空态，不弹全局错误
    detailError.value = err?.code === 40401 ? 'missing' : 'failed'
  } finally {
    detailLoading.value = false
  }
}

/** 载入该设备所属地块的实时环境数据，取出本设备的最新指标 */
async function loadRealtime() {
  const plotId = device.value?.plotId
  if (!plotId) {
    return
  }
  try {
    const data = await fetchRealtime({ plotId })
    realtimeUpdatedAt.value = data?.updatedAt || ''
    realtimeDevice.value = (data?.devices || []).find((item) => item.code === code.value) || null
  } catch {
    realtimeDevice.value = null
  }
}

/**
 * 载入历史曲线：按当前时间范围与采样间隔请求 A07。
 * 7 天窗口以接口返回的最后一个采样点时间（to）为基准回推，不依赖本机时钟。
 */
async function loadHistory() {
  if (!code.value) {
    return
  }
  historyError.value = false
  historyLoading.value = true
  try {
    const params = { deviceCode: code.value, interval: interval.value }
    if (historyRange.value === '7d') {
      const base = toTimestamp(
        history.value?.to || realtimeUpdatedAt.value || device.value?.lastSeen
      )
      if (Number.isFinite(base)) {
        params.from = formatTimestamp(base - 7 * 24 * 60 * 60 * 1000)
        params.to = formatTimestamp(base)
      }
    } else if (historyRange.value === 'custom') {
      if (Array.isArray(customRange.value) && customRange.value.length === 2) {
        params.from = customRange.value[0]
        params.to = customRange.value[1]
      }
    }
    history.value = await fetchHistory(params)
  } catch (err) {
    history.value = { points: [] }
    if (err?.code !== 40401) {
      historyError.value = true
    }
  } finally {
    historyLoading.value = false
  }
}

/** 载入该设备的告警记录 */
async function loadAlarms() {
  if (!code.value) {
    return
  }
  alarmError.value = false
  alarmLoading.value = true
  try {
    const data = await fetchAlarms({
      deviceCode: code.value,
      page: alarmPagination.page,
      size: alarmPagination.size
    })
    alarmList.value = data?.list || []
    alarmPagination.total = data?.total || 0
  } catch (err) {
    if (err?.code !== 40401) {
      alarmError.value = true
    }
  } finally {
    alarmLoading.value = false
  }
}

/**
 * 告警表翻页。
 * @param {{page:number,size:number}} payload 分页事件
 */
function handleAlarmPageChange(payload) {
  alarmPagination.page = payload.page
  alarmPagination.size = payload.size
  loadAlarms()
}

/**
 * 告警表切换每页条数。
 * @param {{page:number,size:number}} payload 分页事件
 */
function handleAlarmSizeChange(payload) {
  alarmPagination.page = 1
  alarmPagination.size = payload.size
  loadAlarms()
}

/**
 * 切换页签：告警与指令首次进入时再加载，避免首屏多打两次请求。
 * @param {string} name 页签名
 */
function handleTabChange(name) {
  if (name === 'alarms' && !alarmList.value.length && !alarmLoading.value) {
    loadAlarms()
  }
}

/**
 * 查询指令回执（A05）：仅本次会话下发的指令存在，其余返回 40401。
 * @param {Object} row 指令行
 */
async function queryCommand(row) {
  if (!row?.requestId || row.querying) {
    return
  }
  row.querying = true
  try {
    const data = await fetchCommand(row.requestId)
    row.status = data?.status || row.status
    row.statusName = data?.statusName || row.statusName
    row.result = data?.result || data?.message || row.result
    ElMessage.success(`指令状态：${row.statusName || row.status || '未知'}`)
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.info('仅支持查询本次会话下发的指令')
    }
  } finally {
    row.querying = false
  }
}

/** 时间范围变更：自定义需要等日期选完再请求 */
function handleRangeChange() {
  if (historyRange.value === 'custom' && (customRange.value || []).length !== 2) {
    return
  }
  loadHistory()
}

/** 返回设备总览 */
function goBack() {
  router.push('/iot/devices')
}

/** 跳转远程控制 */
function goControl() {
  if (!code.value) {
    return
  }
  router.push({ path: '/iot/control', query: { device: code.value } })
}

onMounted(loadDetail)

// 从设备列表切换到另一台设备时组件复用，需要按新编码重新取数
watch(code, () => {
  alarmList.value = []
  alarmPagination.page = 1
  alarmPagination.total = 0
  activeTab.value = 'overview'
  loadDetail()
})
</script>

<template>
  <div class="page-container device-detail">
    <AgriPageHeader
      page-id="P003"
      title="设备详情"
      description="查看单台设备的台账属性、实时指标、历史曲线、告警记录与指令下发回执。"
    >
      <template #extra>
        <el-button @click="goBack">返回设备总览</el-button>
        <el-button type="primary" :disabled="!device" @click="goControl">下发控制</el-button>
      </template>
    </AgriPageHeader>

    <!-- 无编码 / 设备不存在：空态 + 返回入口，避免白屏 -->
    <div v-if="detailError === 'missing'" class="agri-card device-detail__section">
      <AgriEmpty :height="220" description="设备不存在，请检查设备编号是否有效" />
      <div class="device-detail__empty-action">
        <el-button type="primary" @click="goBack">返回设备总览</el-button>
      </div>
    </div>

    <div v-else-if="detailError === 'failed'" class="device-detail__error" @click="loadDetail">
      加载失败，点击重试
    </div>

    <template v-else>
      <!-- 设备概要 -->
      <div class="agri-card device-detail__head">
        <div class="device-detail__head-main">
          <div class="device-detail__title">
            <h2 class="device-detail__name">{{ device?.name || '设备详情' }}</h2>
            <AgriStatusTag v-if="device" :status="device.status" />
          </div>
          <div class="device-detail__meta">
            <span>编号：{{ device?.code || code || '--' }}</span>
            <span>所属地块：{{ device?.plotName || '--' }}</span>
            <span>设备类型：{{ device?.typeName || '--' }}</span>
            <span v-if="realtimeUpdatedAt">数据更新于 {{ realtimeUpdatedAt }}</span>
          </div>
        </div>
      </div>

      <!-- 实时指标卡 -->
      <el-row v-loading="detailLoading" :gutter="16" class="device-detail__stats">
        <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
          <AgriStatCard
            :label="card.label"
            :value="card.value"
            :unit="card.unit"
            :icon="card.icon"
            :tone="card.tone"
            :loading="detailLoading"
          />
        </el-col>
      </el-row>

      <!-- 温湿度 / 光照曲线 -->
      <div class="agri-card device-detail__section">
        <div class="device-detail__section-head">
          <h3 class="device-detail__section-title">温湿度与光照趋势</h3>
          <span class="text-secondary">{{ chartSubtitle }}</span>
        </div>
        <div v-if="historyError" class="device-detail__error" @click="loadHistory">
          加载失败，点击重试
        </div>
        <AgriChart
          v-else
          :option="chartOption"
          :loading="historyLoading"
          :height="320"
          empty-text="该设备暂无历史数据"
        />
      </div>

      <!-- 明细页签 -->
      <div class="agri-card device-detail__section">
        <el-tabs v-model="activeTab" @tab-change="handleTabChange">
          <el-tab-pane label="概览" name="overview">
            <el-descriptions :column="2" border>
              <el-descriptions-item
                v-for="item in attributes"
                :key="item.label"
                :label="item.label"
              >
                {{ item.value || '--' }}
              </el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="实时数据" name="realtime">
            <div class="device-detail__realtime-head">
              <span class="text-secondary">
                数据来源：地块实时环境（A06）{{ realtimeUpdatedAt ? `· ${realtimeUpdatedAt}` : '' }}
              </span>
              <el-button :loading="detailLoading" @click="loadRealtime">刷新</el-button>
            </div>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="空气温度">
                {{ formatMetric(metricSource.temperature, 1) }} ℃
              </el-descriptions-item>
              <el-descriptions-item label="空气湿度">
                {{ formatMetric(metricSource.humidity, 0) }} %
              </el-descriptions-item>
              <el-descriptions-item label="光照强度">
                {{ formatMetric(metricSource.light, 0) }} lux
              </el-descriptions-item>
              <el-descriptions-item label="土壤湿度">
                {{ formatMetric(metricSource.soilMoisture, 0) }} %
              </el-descriptions-item>
              <el-descriptions-item label="土壤温度">
                {{ formatMetric(metricSource.soilTemperature, 1) }} ℃
              </el-descriptions-item>
              <el-descriptions-item label="CO₂ 浓度">
                {{ formatMetric(metricSource.co2, 0) }} ppm
              </el-descriptions-item>
              <el-descriptions-item label="土壤 pH">
                {{ formatMetric(metricSource.ph, 1) }}
              </el-descriptions-item>
              <el-descriptions-item label="土壤 EC">
                {{ formatMetric(metricSource.ec, 2) }} mS/cm
              </el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane label="历史曲线" name="history">
            <div class="device-detail__filters">
              <el-radio-group v-model="historyRange" @change="handleRangeChange">
                <el-radio-button v-for="item in rangeOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </el-radio-button>
              </el-radio-group>
              <el-date-picker
                v-if="historyRange === 'custom'"
                v-model="customRange"
                type="datetimerange"
                value-format="YYYY-MM-DD HH:mm:ss"
                range-separator="至"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
                size="default"
                @change="handleRangeChange"
              />
              <el-select v-model="interval" class="device-detail__interval" @change="loadHistory">
                <el-option
                  v-for="item in intervalOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </div>
            <div v-if="historyError" class="device-detail__error" @click="loadHistory">
              加载失败，点击重试
            </div>
            <AgriChart
              v-else
              :option="chartOption"
              :loading="historyLoading"
              :height="340"
              empty-text="所选范围暂无历史数据"
            />
            <p class="page-note">{{ chartSubtitle || '请选择时间范围后查看曲线' }}</p>
          </el-tab-pane>

          <el-tab-pane label="告警记录" name="alarms">
            <div v-if="alarmError" class="device-detail__error" @click="loadAlarms">
              加载失败，点击重试
            </div>
            <AgriTable
              v-else
              :columns="alarmColumns"
              :data="alarmList"
              :loading="alarmLoading"
              :total="alarmPagination.total"
              :page="alarmPagination.page"
              :size="alarmPagination.size"
              :page-sizes="[5, 10, 20]"
              empty-text="该设备暂无告警记录"
              @page-change="handleAlarmPageChange"
              @size-change="handleAlarmSizeChange"
            >
              <template #level="{ row }">
                <AgriStatusTag :status="row.level" />
              </template>
              <template #status="{ row }">
                <AgriStatusTag :status="row.status" />
              </template>
            </AgriTable>
          </el-tab-pane>

          <el-tab-pane label="指令记录" name="commands">
            <div class="device-detail__realtime-head">
              <span class="text-secondary">
                最近下发 {{ commands.length }} 条；点击「查询状态」按指令号拉取 A05 回执
              </span>
            </div>
            <AgriTable
              :columns="commandColumns"
              :data="commands"
              :loading="detailLoading"
              :show-pagination="false"
              row-key="requestId"
              empty-text="该设备暂无指令下发记录"
            >
              <template #status="{ row }">
                <AgriStatusTag :status="row.status" />
              </template>
              <template #action="{ row }">
                <el-button link type="primary" :loading="row.querying" @click="queryCommand(row)">
                  查询状态
                </el-button>
              </template>
            </AgriTable>
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.device-detail__head {
  margin-bottom: $space-md;
}

.device-detail__head-main {
  display: flex;
  flex-direction: column;
  gap: $space-sm;
}

.device-detail__title {
  display: flex;
  align-items: center;
  gap: $space-sm;
  flex-wrap: wrap;
}

.device-detail__name {
  margin: 0;
  font-size: $font-size-lg;
  font-weight: 600;
  color: $text-primary;
}

.device-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: $space-md;
  font-size: $font-size-sm;
  color: $text-secondary;
}

.device-detail__stats {
  margin-bottom: $space-md;
}

.device-detail__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.device-detail__section {
  margin-bottom: $space-md;
}

.device-detail__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.device-detail__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.device-detail__filters {
  display: flex;
  flex-wrap: wrap;
  gap: $space-sm;
  margin-bottom: $space-md;
}

.device-detail__interval {
  width: 140px;
}

.device-detail__realtime-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.device-detail__empty-action {
  display: flex;
  justify-content: center;
  padding-bottom: $space-lg;
}

.device-detail__error {
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
</style>
