<script setup>
/**
 * P006 设备巡检与离线排查
 * 职责：汇总离线设备、超 24 小时未上报设备与待处置告警，提供离线排查清单，
 *      并支持勾选设备生成巡检任务（演示，不落后端）。
 * 时间基准：以 A06 实时环境的 updatedAt 作为「现在」，不直接使用本机时钟，
 *          避免 mock 固定时间（2026-11-16 18:30:00）与真实时间不一致导致离线时长算错。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { fetchAlarms, fetchDevices, fetchRealtime } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'DevicePatrolPage' })

const router = useRouter()

// 全量设备（当前规模 48 台，一次取全量在前端分组，避免多次分页请求）
const devices = ref([])
const loading = ref(false)
const loadError = ref(false)

// 「现在」：取 A06 的 updatedAt；接口异常时回落到设备最后上报时间的最大值
const nowText = ref('')
const pendingAlarmTotal = ref(0)

// 已本地标记为「已排查」的设备编码（仅前端置灰，不写后端）
const handledCodes = ref(new Set())

// 巡检清单勾选
const patrolTableRef = ref(null)
const selectedRows = ref([])

// 生成巡检任务弹窗
const dialogVisible = ref(false)
const dialogLoading = ref(false)

const taskFields = [
  {
    prop: 'inspector',
    label: '巡检人',
    type: 'input',
    required: true,
    placeholder: '请输入巡检人姓名'
  },
  {
    prop: 'planDate',
    label: '计划时间',
    type: 'date',
    required: true,
    placeholder: '请选择计划巡检日期'
  },
  {
    prop: 'remark',
    label: '备注',
    type: 'textarea',
    span: 2,
    placeholder: '可填写巡检重点、携带工具等'
  }
]

// 离线/异常设备：状态非 ONLINE 的全部算作待排查
const offlineDevices = computed(() => devices.value.filter((device) => device.status !== 'ONLINE'))

const staleDevices = computed(() =>
  offlineDevices.value.filter((device) => isStale(device.lastSeen))
)

const statCards = computed(() => [
  {
    label: '离线设备',
    value: offlineDevices.value.length,
    unit: '台',
    icon: 'SwitchButton',
    tone: 'warn',
    delta: ''
  },
  {
    label: '超 24h 未上报',
    value: staleDevices.value.length,
    unit: '台',
    icon: 'Timer',
    tone: 'danger',
    delta: ''
  },
  {
    label: '待处置告警',
    value: pendingAlarmTotal.value,
    unit: '条',
    icon: 'Warning',
    tone: 'danger',
    delta: ''
  }
])

const offlineColumns = [
  { prop: 'code', label: '设备编号', minWidth: 150, showOverflowTooltip: true },
  { prop: 'name', label: '设备名称', minWidth: 150, showOverflowTooltip: true },
  { prop: 'plotName', label: '所属地块', minWidth: 150, showOverflowTooltip: true },
  { prop: 'lastSeen', label: '最后上报', minWidth: 170 },
  { prop: 'offlineDuration', label: '离线时长', minWidth: 140, slot: 'offlineDuration' },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'action', label: '操作', width: 180, align: 'center', slot: 'action' }
]

const patrolColumns = [
  { prop: 'code', label: '设备编号', minWidth: 150, showOverflowTooltip: true },
  { prop: 'name', label: '设备名称', minWidth: 150, showOverflowTooltip: true },
  { prop: 'typeName', label: '设备类型', minWidth: 130 },
  { prop: 'plotName', label: '所属地块', minWidth: 150, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'lastSeen', label: '最后上报', minWidth: 170 }
]

// 排查建议：按设备类别给静态文案（3–5 条），不依赖后端
const suggestions = [
  {
    key: 'sensor',
    title: '传感器类（温湿度 / 光照 / CO₂ / 土壤墒情 / 气象站）',
    tips: [
      '先看信号强度：低于 -85 dBm 时优先检查天线朝向与遮挡物，必要时加装中继。',
      '断电重启前先确认供电电压，太阳能供电设备需检查蓄电池与充电控制器。',
      '探头长时间埋土易结垢，土壤墒情仪建议每季度清洗探头并重新标定。',
      '同地块多台设备同时离线时，优先排查网关与交换机，而不是逐台设备。'
    ]
  },
  {
    key: 'camera',
    title: '视频设备（高清球机）',
    tips: [
      '确认 PoE 交换机端口指示灯状态，端口不亮先换线再换端口。',
      '离线超过 24 小时多半是取电或链路问题，安排现场巡检时携带备用网线与电源。',
      '画面卡顿而非离线时，检查上行带宽与码流配置，优先降低子码流分辨率。'
    ]
  },
  {
    key: 'actuator',
    title: '执行设备（灌溉电磁阀 / 环流风机）',
    tips: [
      '先确认设备状态是「故障」还是「离线」：故障通常伴随执行超时或反馈异常。',
      '电磁阀动作后无反馈，检查阀体是否卡涩、水压是否不足。',
      '风机类设备关注电流与转速反馈，异常时先停机再排查电机与变频器。'
    ]
  },
  {
    key: 'common',
    title: '通用排查顺序',
    tips: [
      '一看供电、二看网络、三看平台心跳，按顺序排除，避免盲目拆机。',
      '设备列表与告警记录交叉核对：先处理 24 小时内反复上下线的设备，通常是链路不稳。',
      '现场处理后回填巡检备注，并在设备详情页确认最后上报时间已更新。'
    ]
  }
]

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
 * 判断设备最后上报是否已超过 24 小时。
 * @param {string} lastSeen 最后上报时间
 * @returns {boolean} 是否超时
 */
function isStale(lastSeen) {
  const now = toTimestamp(nowText.value)
  const last = toTimestamp(lastSeen)
  if (!Number.isFinite(now) || !Number.isFinite(last)) {
    return false
  }
  return now - last > 24 * 60 * 60 * 1000
}

/**
 * 计算离线时长文案：以接口时间为基准做差，超过 1 天显示「x 天 y 小时」。
 * @param {string} lastSeen 最后上报时间
 * @returns {string} 时长文案
 */
function offlineDuration(lastSeen) {
  const diff = toTimestamp(nowText.value) - toTimestamp(lastSeen)
  if (!Number.isFinite(diff) || diff <= 0) {
    return '--'
  }
  const totalHours = Math.floor(diff / (60 * 60 * 1000))
  if (totalHours >= 24) {
    return `${Math.floor(totalHours / 24)} 天 ${totalHours % 24} 小时`
  }
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))
  return `${totalHours} 小时 ${minutes} 分`
}

/**
 * 离线设备行附带的离线时长，供表格插槽直接读取。
 * @param {Object} row 设备行
 * @returns {string} 时长文案
 */
function durationOf(row) {
  return offlineDuration(row.lastSeen)
}

/** 载入概览数据：设备全量、待处置告警总数、接口时间基准 */
async function loadOverview() {
  loadError.value = false
  loading.value = true
  try {
    const [deviceData, alarmData, realtimeData] = await Promise.all([
      fetchDevices({ page: 1, size: 100 }),
      fetchAlarms({ page: 1, size: 1, status: 'PENDING' }),
      fetchRealtime()
    ])
    devices.value = deviceData?.list || []
    pendingAlarmTotal.value = alarmData?.total || 0
    nowText.value = realtimeData?.updatedAt || ''
    if (!nowText.value) {
      // 兜底：用设备最后上报时间的最大值当基准，仍不依赖本机时钟
      const stamps = devices.value.map((device) => toTimestamp(device.lastSeen))
      const maxStamp = stamps.filter((stamp) => Number.isFinite(stamp)).sort((a, b) => b - a)[0]
      nowText.value = Number.isFinite(maxStamp)
        ? new Date(maxStamp).toISOString().replace('T', ' ').slice(0, 19)
        : ''
    }
  } catch (err) {
    devices.value = []
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/**
 * 勾选变化：记录当前页选中的设备行。
 * @param {Array} rows 选中行
 */
function handleSelectionChange(rows) {
  selectedRows.value = rows
}

/**
 * 标记已排查：仅本地置灰，不调用后端接口（本轮不新增假接口）。
 * @param {Object} row 设备行
 */
function markHandled(row) {
  const next = new Set(handledCodes.value)
  next.add(row.code)
  handledCodes.value = next
  ElMessage.success(`${row.name} 已标记为排查完成`)
}

/**
 * 是否已本地标记排查。
 * @param {string} code 设备编码
 * @returns {boolean} 是否已处理
 */
function isHandled(code) {
  return handledCodes.value.has(code)
}

/** 打开「生成巡检任务」弹窗 */
function openTaskDialog() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先在巡检清单中勾选设备')
    return
  }
  dialogVisible.value = true
}

/**
 * 提交巡检任务：本轮不落后端，只做成功提示并清空勾选。
 * @param {Object} form 表单数据
 */
async function handleTaskSubmit(form) {
  dialogLoading.value = true
  try {
    const count = selectedRows.value.length
    ElMessage.success(`已为 ${count} 台设备生成巡检任务（巡检人：${form.inspector}）`)
    dialogVisible.value = false
    selectedRows.value = []
    patrolTableRef.value?.clearSelection()
  } finally {
    dialogLoading.value = false
  }
}

/** 跳转设备详情 */
function goDetail(row) {
  router.push({ path: '/iot/devices/detail', query: { code: row.code } })
}

onMounted(loadOverview)
</script>

<template>
  <div class="page-container device-patrol">
    <AgriPageHeader
      page-id="P006"
      title="设备巡检与离线排查"
      description="汇总离线设备与超时未上报设备，勾选设备生成巡检任务，并按类别查看排查建议。"
    >
      <template #extra>
        <span v-if="nowText" class="device-patrol__now">数据基准时间 {{ nowText }}</span>
        <el-button :loading="loading" @click="loadOverview">刷新</el-button>
      </template>
    </AgriPageHeader>

    <div v-if="loadError" class="device-patrol__error" @click="loadOverview">
      加载失败，点击重试
    </div>
    <template v-else>
      <!-- 概览卡 -->
      <el-row :gutter="16" class="device-patrol__stats">
        <el-col v-for="card in statCards" :key="card.label" :xs="24" :sm="8" :md="8">
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

      <!-- 离线设备 -->
      <div class="agri-card device-patrol__section">
        <div class="device-patrol__section-head">
          <h3 class="device-patrol__section-title">离线设备</h3>
          <span class="text-secondary">共 {{ offlineDevices.length }} 台待排查</span>
        </div>
        <AgriEmpty
          v-if="!loading && !offlineDevices.length"
          :height="200"
          description="当前没有离线设备，全部设备在线"
        />
        <AgriTable
          v-else
          :columns="offlineColumns"
          :data="offlineDevices"
          :loading="loading"
          :show-pagination="false"
          row-key="code"
          empty-text="暂无离线设备"
        >
          <template #offlineDuration="{ row }">
            <span :class="{ 'device-patrol__stale': isStale(row.lastSeen) }">
              {{ durationOf(row) }}
            </span>
          </template>
          <template #status="{ row }">
            <AgriStatusTag :status="row.status" />
          </template>
          <template #action="{ row }">
            <el-button link type="primary" @click="goDetail(row)">查看详情</el-button>
            <el-button
              link
              type="primary"
              :disabled="isHandled(row.code)"
              @click="markHandled(row)"
            >
              {{ isHandled(row.code) ? '已排查' : '标记已排查' }}
            </el-button>
          </template>
        </AgriTable>
      </div>

      <!-- 巡检清单 -->
      <div class="agri-card device-patrol__section">
        <div class="device-patrol__section-head">
          <h3 class="device-patrol__section-title">巡检清单</h3>
          <div class="device-patrol__section-actions">
            <span class="text-secondary">已选 {{ selectedRows.length }} 台</span>
            <el-button type="primary" :disabled="!selectedRows.length" @click="openTaskDialog">
              生成巡检任务
            </el-button>
          </div>
        </div>
        <AgriTable
          ref="patrolTableRef"
          :columns="patrolColumns"
          :data="devices"
          :loading="loading"
          :show-pagination="false"
          row-key="code"
          selection
          empty-text="暂无设备可巡检"
          @selection-change="handleSelectionChange"
        >
          <template #status="{ row }">
            <AgriStatusTag :status="row.status" />
          </template>
        </AgriTable>
      </div>

      <!-- 排查建议 -->
      <div class="agri-card device-patrol__section">
        <div class="device-patrol__section-head">
          <h3 class="device-patrol__section-title">排查建议</h3>
          <span class="text-secondary">按设备类别整理的现场排查顺序</span>
        </div>
        <el-collapse>
          <el-collapse-item
            v-for="item in suggestions"
            :key="item.key"
            :title="item.title"
            :name="item.key"
          >
            <ul class="device-patrol__tips">
              <li v-for="tip in item.tips" :key="tip">{{ tip }}</li>
            </ul>
          </el-collapse-item>
        </el-collapse>
      </div>
    </template>

    <!-- 生成巡检任务 -->
    <AgriFormDialog
      v-model="dialogVisible"
      title="生成巡检任务"
      :fields="taskFields"
      :loading="dialogLoading"
      submit-text="生成任务"
      @submit="handleTaskSubmit"
    />
  </div>
</template>

<style scoped lang="scss">
.device-patrol__now {
  margin-right: $space-sm;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.device-patrol__stats {
  margin-bottom: $space-md;
}

.device-patrol__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.device-patrol__section {
  margin-bottom: $space-md;
}

.device-patrol__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.device-patrol__section-actions {
  display: flex;
  align-items: center;
  gap: $space-sm;
}

.device-patrol__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

// 超过 24 小时未上报用危险色强调
.device-patrol__stale {
  color: $danger-color;
  font-weight: 600;
}

.device-patrol__tips {
  margin: 0;
  padding-left: $space-lg;
  color: $text-regular;
  font-size: $font-size-sm;
  line-height: 1.9;
}

.device-patrol__error {
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
  .device-patrol__section-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
