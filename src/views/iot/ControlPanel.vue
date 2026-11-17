<script setup>
/**
 * P007 远程控制
 * 职责：选择执行器（电磁阀 / 环流风机 / 补光灯 / 卷帘），
 *      通过 A04 下发控制指令，并用 A05 轮询回执把 PENDING 刷成 SUCCESS。
 * 说明：
 * - 安全锁开启后所有执行按钮禁用，接口侧仍会兜底返回 42301；
 * - 每次下发用 createRequestId 生成幂等号，「重放上次请求」可复现 40901；
 * - mock 当前时间固定为 2026-11-16 18:30:00，页面相对时间取接口返回的 updatedAt。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'

import {
  createRequestId,
  fetchCommand,
  fetchControlLogs,
  fetchDevices,
  fetchSafetyLock,
  sendCommand,
  updateSafetyLock
} from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'ControlPanelPage' })

const route = useRoute()

// 执行器类型中文名与能力分支
const TYPE_LABELS = {
  VALVE: '灌溉电磁阀',
  FAN: '环流风机',
  LIGHT: '补光灯',
  CURTAIN: '卷帘',
  GENERIC: '通用执行器'
}

// 指令状态映射：A05/A09 共用，内置映射不含 SUCCESS/FAILED
const CONTROL_STATUS_MAP = {
  PENDING: { text: '下发中', type: 'warning' },
  SUCCESS: { text: '成功', type: 'success' },
  FAILED: { text: '失败', type: 'danger' },
  TIMEOUT: { text: '超时', type: 'info' }
}

const ACTION_NAMES = {
  ON: '开机',
  OFF: '停机',
  OPEN: '开启',
  CLOSE: '关闭',
  SET_MODE: '模式设置',
  RESTART: '重启'
}

const devices = ref([])
const devicesLoading = ref(false)
const devicesError = ref(false)
const keyword = ref('')
const typeFilter = ref('')

const selected = ref(null)
const safetyLock = ref(false)
const lockLoading = ref(false)

const deviceLogs = ref([])
const deviceLogsLoading = ref(false)
const allLogs = ref([])
const allLogsLoading = ref(false)

const sessionCommands = ref([])
const receipt = ref(null)
const receiptTrail = ref([])
const lastSubmission = ref(null)
const executing = ref(false)

const todayText = ref('')

// 各类型控制面板的本地状态
const valveAction = ref('OPEN')
const valveTimed = ref(false)
const valveDuration = ref(30)
const fanLevel = ref(1)
const lightOn = ref(true)
const lightBrightness = ref(70)
const curtainAction = ref('OPEN')
const genericAction = ref('ON')

const controlType = computed(() => {
  const type = selected.value?.type
  if (type === 'VALVE' || type === 'FAN' || type === 'LIGHT' || type === 'CURTAIN') {
    return type
  }
  return 'GENERIC'
})

const actuators = computed(() => devices.value.filter((item) => item.category === 'ACTUATOR'))

const typeOptions = [
  { label: '全部', value: '' },
  { label: '电磁阀', value: 'VALVE' },
  { label: '风机', value: 'FAN' },
  { label: '补光灯', value: 'LIGHT' },
  { label: '卷帘', value: 'CURTAIN' }
]

const filteredDevices = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return actuators.value.filter((device) => {
    const matchType = !typeFilter.value || device.type === typeFilter.value
    const matchText =
      !text ||
      [device.name, device.code, device.plotName].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(text)
      )
    return matchType && matchText
  })
})

const statCards = computed(() => [
  {
    label: '可控执行器',
    value: actuators.value.length,
    unit: '台',
    icon: 'Cpu',
    tone: 'brand'
  },
  {
    label: '在线执行器',
    value: actuators.value.filter((item) => item.status === 'ONLINE').length,
    unit: '台',
    icon: 'Connection',
    tone: 'ok'
  },
  {
    label: '今日指令',
    value: todayCommandCount.value,
    unit: '条',
    icon: 'Tickets',
    tone: 'warn'
  },
  {
    label: '安全锁',
    value: safetyLock.value ? '已锁定' : '未锁定',
    unit: '',
    icon: 'Lock',
    tone: safetyLock.value ? 'danger' : 'ok'
  }
])

const todayCommandCount = computed(() => {
  const day = todayText.value.slice(0, 10)
  if (!day) {
    return 0
  }
  return allLogs.value.filter((item) => String(item.createdAt || '').startsWith(day)).length
})

const deviceCommandRows = computed(() => {
  const code = selected.value?.code
  if (!code) {
    return []
  }
  const sessionRows = sessionCommands.value
    .filter((item) => item.deviceCode === code)
    .map((item) => ({ ...item, key: item.requestId }))
  const logRows = deviceLogs.value.map((item) => ({
    key: item.id,
    requestId: item.requestId,
    createdAt: item.createdAt,
    action: item.action,
    actionName: item.actionName,
    paramsText: '—',
    status: item.status,
    statusName: item.statusName,
    sourceName: item.sourceName || '人工下发'
  }))
  const existing = new Set(sessionRows.map((item) => item.requestId))
  return [...sessionRows, ...logRows.filter((item) => !existing.has(item.requestId))]
    .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))
    .slice(0, 10)
})

const allLogRows = computed(() =>
  allLogs.value.map((item) => ({
    ...item,
    key: item.id
  }))
)

const commandColumns = [
  { prop: 'createdAt', label: '时间', minWidth: 168 },
  { prop: 'actionName', label: '指令', width: 110 },
  { prop: 'paramsText', label: '参数', minWidth: 150, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'requestId', label: '请求编号', minWidth: 200, showOverflowTooltip: true },
  { prop: 'sourceName', label: '来源', width: 110 }
]

const recentColumns = [
  { prop: 'createdAt', label: '时间', minWidth: 168 },
  { prop: 'deviceName', label: '设备', minWidth: 140, showOverflowTooltip: true },
  { prop: 'actionName', label: '指令', width: 100 },
  { prop: 'operator', label: '操作人', width: 100 },
  { prop: 'status', label: '结果', width: 90, slot: 'status' }
]

/**
 * 把接口时间串转成毫秒时间戳（兼容 iOS 与 Windows 的日期解析差异）。
 * @param {string} text 时间串
 * @returns {number} 毫秒时间戳，非法值返回 0
 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 参数摘要：对象转 JSON，空值显示短横线 */
function paramsSummary(params) {
  if (!params || !Object.keys(params).length) {
    return '—'
  }
  return JSON.stringify(params)
}

/**
 * 根据当前控制面板状态组装 A04 请求体。
 * @returns {{deviceCode:string,action:string,params:Object,remark:string}}
 */
function buildCommandPayload() {
  const base = {
    deviceCode: selected.value.code,
    action: 'ON',
    params: {},
    remark: 'P007 远程控制页下发'
  }
  if (controlType.value === 'VALVE') {
    base.action = valveAction.value
    if (valveAction.value === 'OPEN' && valveTimed.value) {
      base.params = { duration: valveDuration.value }
    }
    return base
  }
  if (controlType.value === 'FAN') {
    base.action = fanLevel.value === 0 ? 'OFF' : 'ON'
    base.params = { level: fanLevel.value }
    return base
  }
  if (controlType.value === 'LIGHT') {
    base.action = lightOn.value ? 'ON' : 'OFF'
    base.params = { brightness: lightOn.value ? lightBrightness.value : 0 }
    return base
  }
  if (controlType.value === 'CURTAIN') {
    if (curtainAction.value === 'STOP') {
      base.action = 'SET_MODE'
      base.params = { mode: 'STOP' }
    } else {
      base.action = curtainAction.value
    }
    return base
  }
  base.action = genericAction.value
  return base
}

/** 当前动作的中文名（含参数摘要，用于回执区展示） */
const currentActionName = computed(() => {
  if (!selected.value) {
    return '—'
  }
  const payload = buildCommandPayload()
  const name = ACTION_NAMES[payload.action] || payload.action
  if (controlType.value === 'CURTAIN') {
    return { OPEN: '升帘', STOP: '停帘', CLOSE: '降帘' }[curtainAction.value] || name
  }
  if (!Object.keys(payload.params).length) {
    return name
  }
  return `${name}（${paramsSummary(payload.params)}）`
})

/**
 * 静默等待，用于两次回执轮询之间留出状态刷新间隔。
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 载入执行器台账：A03 一次拉 100 台后在页面内按 category 过滤。
 * 失败进入页面错误态，允许点击重试。
 */
async function loadDevices() {
  devicesLoading.value = true
  devicesError.value = false
  try {
    const data = await fetchDevices({ page: 1, size: 100 })
    devices.value = data?.list || []
    const preferredCode = String(route.query.device || '')
    const target =
      devices.value.find((item) => item.code === preferredCode) ||
      actuators.value.find((item) => item.type === 'VALVE') ||
      actuators.value[0]
    if (target) {
      selectDevice(target)
    }
  } catch (err) {
    if (err?.code !== 40401) {
      devicesError.value = true
    }
  } finally {
    devicesLoading.value = false
  }
}

/** 载入安全锁状态，并用返回的 updatedAt 作为页面「今天」的基准 */
async function loadSafetyLock() {
  try {
    const data = await fetchSafetyLock()
    safetyLock.value = Boolean(data?.safetyLock)
    todayText.value = data?.updatedAt || ''
  } catch {
    safetyLock.value = false
  }
}

/** 载入全站最近控制日志，同时用于今日指令统计与下方 3 行表格 */
async function loadAllLogs() {
  allLogsLoading.value = true
  try {
    const data = await fetchControlLogs({ page: 1, size: 100 })
    allLogs.value = data?.list || []
    if (!todayText.value && allLogs.value.length) {
      todayText.value = allLogs.value[0].createdAt
    }
  } catch (err) {
    if (err?.code !== 40401) {
      allLogs.value = []
    }
  } finally {
    allLogsLoading.value = false
  }
}

/**
 * 载入当前设备的指令历史（A09 按 deviceCode 过滤）。
 * @param {string} code 设备编号
 */
async function loadDeviceLogs(code) {
  if (!code) {
    deviceLogs.value = []
    return
  }
  deviceLogsLoading.value = true
  try {
    const data = await fetchControlLogs({ page: 1, size: 10, deviceCode: code })
    deviceLogs.value = data?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      deviceLogs.value = []
    }
  } finally {
    deviceLogsLoading.value = false
  }
}

/**
 * 选中执行器：清空上一台设备的回执与本地记录，再拉取该设备日志。
 * @param {Object} device 设备对象
 */
function selectDevice(device) {
  selected.value = device
  receipt.value = null
  receiptTrail.value = []
  lastSubmission.value = null
  valveAction.value = 'OPEN'
  valveTimed.value = false
  valveDuration.value = 30
  fanLevel.value = 1
  lightOn.value = true
  lightBrightness.value = 70
  curtainAction.value = 'OPEN'
  genericAction.value = 'ON'
  loadDeviceLogs(device.code)
}

/**
 * 切换安全锁：真实调用 A04，失败回滚开关状态。
 * @param {boolean} value 目标状态
 */
async function handleLockChange(value) {
  const previous = safetyLock.value
  safetyLock.value = value
  lockLoading.value = true
  try {
    const data = await updateSafetyLock({ locked: value })
    safetyLock.value = Boolean(data?.safetyLock)
    todayText.value = data?.updatedAt || todayText.value
    ElMessage.success(safetyLock.value ? '安全锁已开启' : '安全锁已关闭')
  } catch (err) {
    safetyLock.value = previous
    if (err?.code !== 40401) {
      ElMessage.closeAll()
      ElMessage.error('安全锁切换失败，请稍后重试')
    }
  } finally {
    lockLoading.value = false
  }
}

/** 把一条指令对象追加到当前设备的本地会话记录，并按 requestId 更新 */
function upsertSessionCommand(command) {
  if (!command?.requestId) {
    return
  }
  const row = {
    key: command.requestId,
    requestId: command.requestId,
    deviceCode: command.deviceCode,
    deviceName: command.deviceName,
    createdAt: command.createdAt,
    action: command.action,
    actionName: command.actionName,
    paramsText: paramsSummary(command.params),
    status: command.status,
    statusName: command.statusName,
    sourceName: '本次会话'
  }
  const index = sessionCommands.value.findIndex((item) => item.requestId === command.requestId)
  if (index >= 0) {
    sessionCommands.value.splice(index, 1, row)
  } else {
    sessionCommands.value.unshift(row)
  }
}

/**
 * 轮询 A05 回执：mock 第 1 次返回 PENDING，第 2 次返回 SUCCESS。
 * @param {string} requestId 幂等号
 * @param {Object} initialCommand A04 返回的初始回执
 */
async function pollReceipt(requestId, initialCommand) {
  receipt.value = initialCommand
  receiptTrail.value = [
    {
      status: initialCommand.status,
      text: `${initialCommand.statusName || '下发中'}（指令已受理）`,
      at: initialCommand.createdAt
    }
  ]
  for (let i = 0; i < 3; i += 1) {
    await sleep(800)
    try {
      const data = await fetchCommand(requestId)
      receipt.value = data
      upsertSessionCommand(data)
      receiptTrail.value.push({
        status: data.status,
        text: data.statusName || data.status,
        at: data.finishedAt || data.createdAt
      })
      if (data.status === 'SUCCESS' || data.status === 'FAILED') {
        break
      }
    } catch (err) {
      if (err?.code !== 40401) {
        ElMessage.warning('回执查询失败，请稍后手动刷新')
      }
      break
    }
  }
  if (receipt.value?.status === 'SUCCESS') {
    ElMessage.success('指令执行成功')
  } else if (receipt.value?.status === 'FAILED') {
    ElMessage.error('指令执行失败，请检查设备状态')
  } else {
    ElMessage.info('指令仍在执行，可点击「刷新回执」继续查询')
  }
}

/**
 * 下发指令：生成幂等号 → A04 → 轮询 A05 → 更新回执与本地记录。
 */
async function executeCommand() {
  if (!selected.value) {
    ElMessage.warning('请先选择执行器')
    return
  }
  if (safetyLock.value) {
    ElMessage.warning('安全锁已开启，远程控制已锁定')
    return
  }
  if (controlType.value === 'VALVE' && valveTimed.value) {
    if (!valveDuration.value || valveDuration.value < 1 || valveDuration.value > 180) {
      ElMessage.warning('定时时长需在 1~180 分钟之间')
      return
    }
  }
  const payload = buildCommandPayload()
  const requestId = createRequestId('CTL')
  executing.value = true
  try {
    const command = await sendCommand(payload, requestId)
    ElMessage.success('指令已下发')
    lastSubmission.value = { payload, requestId }
    upsertSessionCommand(command)
    await pollReceipt(requestId, command)
  } catch (err) {
    if (err?.code === 42301) {
      safetyLock.value = true
      ElMessage.closeAll()
      ElMessage.warning('安全锁已开启，远程控制已锁定')
    } else if (err?.code === 40901) {
      ElMessage.closeAll()
      ElMessage.warning('该请求编号已提交过')
    } else if (err?.code === 40301) {
      ElMessage.closeAll()
      ElMessage.warning('当前账号无此操作权限')
    }
  } finally {
    executing.value = false
  }
}

/**
 * 重放上次请求：复用同一 requestId，用于演示 40901 幂等校验。
 */
async function replayLastRequest() {
  if (!lastSubmission.value) {
    return
  }
  if (safetyLock.value) {
    ElMessage.warning('安全锁已开启，远程控制已锁定')
    return
  }
  executing.value = true
  try {
    await sendCommand(lastSubmission.value.payload, lastSubmission.value.requestId)
    ElMessage.info('本次请求编号未被拦截，请确认接口幂等状态')
  } catch (err) {
    if (err?.code === 40901) {
      ElMessage.closeAll()
      ElMessage.warning('该请求编号已提交过')
    } else if (err?.code === 40301) {
      ElMessage.closeAll()
      ElMessage.warning('当前账号无此操作权限')
    }
  } finally {
    executing.value = false
  }
}

/** 手动刷新当前回执，不重复下发 */
async function refreshReceipt() {
  if (!receipt.value?.requestId) {
    return
  }
  try {
    const data = await fetchCommand(receipt.value.requestId)
    receipt.value = data
    upsertSessionCommand(data)
    receiptTrail.value.push({
      status: data.status,
      text: data.statusName || data.status,
      at: data.finishedAt || data.createdAt
    })
    ElMessage.success('回执已刷新')
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.warning('回执查询失败')
    }
  }
}

onMounted(async () => {
  await Promise.all([loadSafetyLock(), loadAllLogs(), loadDevices()])
})
</script>

<template>
  <div class="page-container control-panel">
    <AgriPageHeader
      page-id="P007"
      title="远程控制"
      description="选择执行器下发控制指令，跟踪指令回执与全站操作记录。"
    />

    <el-row :gutter="16" class="control-panel__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
          :loading="devicesLoading || allLogsLoading"
        />
      </el-col>
    </el-row>

    <div class="control-panel__layout">
      <aside class="agri-card control-panel__aside">
        <div class="control-panel__aside-head">
          <div>
            <h3 class="control-panel__card-title">执行器</h3>
            <p class="control-panel__muted">共 {{ actuators.length }} 台可控设备</p>
          </div>
          <el-button link type="primary" :loading="devicesLoading" @click="loadDevices">
            刷新
          </el-button>
        </div>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索设备名称 / 编号 / 地块"
          class="control-panel__search"
        />
        <el-radio-group v-model="typeFilter" size="small" class="control-panel__types">
          <el-radio-button v-for="item in typeOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>

        <div v-if="devicesError" class="control-panel__error" @click="loadDevices">
          加载失败，点击重试
        </div>
        <div v-else-if="devicesLoading" class="control-panel__loading">
          <el-skeleton :rows="3" animated />
        </div>
        <AgriEmpty v-else-if="!filteredDevices.length" description="暂无匹配的执行器" />
        <div v-else class="control-panel__device-list">
          <button
            v-for="device in filteredDevices"
            :key="device.code"
            type="button"
            class="control-panel__device"
            :class="{ 'is-active': selected?.code === device.code }"
            @click="selectDevice(device)"
          >
            <span class="control-panel__device-name">{{ device.name }}</span>
            <span class="control-panel__device-meta">
              {{ TYPE_LABELS[device.type] || device.typeName }} · {{ device.plotName }}
            </span>
            <span class="control-panel__device-foot">
              <AgriStatusTag :status="device.status" />
              <span class="control-panel__device-code">{{ device.code }}</span>
            </span>
          </button>
        </div>
      </aside>

      <section class="control-panel__main">
        <AgriEmpty v-if="!selected" description="请从左侧选择一台执行器" />

        <template v-else>
          <div class="agri-card control-panel__device-head">
            <div>
              <div class="control-panel__title-line">
                <h3 class="control-panel__device-title">{{ selected.name }}</h3>
                <AgriStatusTag :status="selected.status" />
              </div>
              <p class="control-panel__muted">
                {{ selected.code }} · {{ selected.plotName }} · {{ TYPE_LABELS[controlType] }} ·
                固件 {{ selected.firmware || '-' }}
              </p>
            </div>
            <div class="control-panel__lock">
              <span class="control-panel__lock-label">安全锁</span>
              <el-switch
                :model-value="safetyLock"
                :loading="lockLoading"
                active-text="开启"
                inactive-text="关闭"
                @change="handleLockChange"
              />
            </div>
          </div>

          <el-alert
            v-if="safetyLock"
            type="warning"
            show-icon
            :closable="false"
            title="安全锁已开启，远程控制已锁定"
            description="关闭安全锁后才能下发控制指令。"
            class="control-panel__alert"
          />

          <div class="agri-card control-panel__control" :class="{ 'is-locked': safetyLock }">
            <div class="control-panel__control-head">
              <h3 class="control-panel__card-title">控制面板</h3>
              <span class="control-panel__muted">当前动作：{{ currentActionName }}</span>
            </div>

            <div v-if="controlType === 'VALVE'" class="control-panel__form">
              <el-radio-group v-model="valveAction" :disabled="safetyLock">
                <el-radio-button value="OPEN">开启阀门</el-radio-button>
                <el-radio-button value="CLOSE">关闭阀门</el-radio-button>
              </el-radio-group>
              <div v-if="valveAction === 'OPEN'" class="control-panel__inline">
                <el-checkbox v-model="valveTimed" :disabled="safetyLock">定时灌溉</el-checkbox>
                <el-input-number
                  v-if="valveTimed"
                  v-model="valveDuration"
                  :min="1"
                  :max="180"
                  :disabled="safetyLock"
                  controls-position="right"
                />
                <span v-if="valveTimed" class="control-panel__muted">分钟</span>
              </div>
            </div>

            <div v-else-if="controlType === 'FAN'" class="control-panel__form">
              <div class="control-panel__inline">
                <span class="control-panel__label">风机档位</span>
                <el-slider
                  v-model="fanLevel"
                  :min="0"
                  :max="3"
                  :step="1"
                  show-stops
                  :disabled="safetyLock"
                  class="control-panel__slider"
                />
                <span class="control-panel__value">{{ fanLevel }} 档</span>
              </div>
              <p class="control-panel__muted">0 档为停机，1~3 档风速依次增强。</p>
            </div>

            <div v-else-if="controlType === 'LIGHT'" class="control-panel__form">
              <div class="control-panel__inline">
                <span class="control-panel__label">补光灯</span>
                <el-switch
                  v-model="lightOn"
                  active-text="开启"
                  inactive-text="关闭"
                  :disabled="safetyLock"
                />
              </div>
              <div class="control-panel__inline">
                <span class="control-panel__label">亮度</span>
                <el-slider
                  v-model="lightBrightness"
                  :min="0"
                  :max="100"
                  :disabled="safetyLock || !lightOn"
                  class="control-panel__slider"
                />
                <span class="control-panel__value">{{ lightBrightness }}%</span>
              </div>
            </div>

            <div v-else-if="controlType === 'CURTAIN'" class="control-panel__form">
              <div class="control-panel__inline">
                <span class="control-panel__label">卷帘动作</span>
                <el-radio-group v-model="curtainAction" :disabled="safetyLock">
                  <el-radio-button value="OPEN">升</el-radio-button>
                  <el-radio-button value="STOP">停</el-radio-button>
                  <el-radio-button value="CLOSE">降</el-radio-button>
                </el-radio-group>
              </div>
            </div>

            <div v-else class="control-panel__form">
              <el-radio-group v-model="genericAction" :disabled="safetyLock">
                <el-radio-button value="ON">开机</el-radio-button>
                <el-radio-button value="OFF">停机</el-radio-button>
              </el-radio-group>
            </div>

            <div class="control-panel__actions">
              <el-button
                type="primary"
                :loading="executing"
                :disabled="safetyLock"
                @click="executeCommand"
              >
                执行
              </el-button>
              <el-button v-if="lastSubmission" :disabled="safetyLock" @click="replayLastRequest">
                重放上次请求
              </el-button>
              <span class="control-panel__muted">
                指令带 X-Request-Id 幂等号，重复提交会返回 40901。
              </span>
            </div>
          </div>

          <div v-if="receipt" class="agri-card control-panel__receipt">
            <div class="control-panel__control-head">
              <h3 class="control-panel__card-title">指令回执</h3>
              <div class="control-panel__inline">
                <AgriStatusTag :status="receipt.status" :map="CONTROL_STATUS_MAP" />
                <el-button link type="primary" @click="refreshReceipt">刷新回执</el-button>
              </div>
            </div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="请求编号">
                {{ receipt.requestId }}
              </el-descriptions-item>
              <el-descriptions-item label="指令编号">
                {{ receipt.commandId || '-' }}
              </el-descriptions-item>
              <el-descriptions-item label="下发时间">
                {{ receipt.createdAt || '-' }}
              </el-descriptions-item>
              <el-descriptions-item label="完成时间">
                {{ receipt.finishedAt || '-' }}
              </el-descriptions-item>
              <el-descriptions-item label="执行结果" :span="2">
                {{ receipt.result || '等待设备反馈' }}
              </el-descriptions-item>
            </el-descriptions>
            <div class="control-panel__trail">
              <div
                v-for="(step, index) in receiptTrail"
                :key="`${step.status}-${index}`"
                class="control-panel__trail-item"
              >
                <span
                  class="control-panel__dot"
                  :class="{
                    'is-ok': step.status === 'SUCCESS',
                    'is-fail': step.status === 'FAILED',
                    'is-pending': step.status === 'PENDING'
                  }"
                />
                <span class="control-panel__trail-time">{{ step.at || '-' }}</span>
                <span>{{ step.text }}</span>
              </div>
            </div>
          </div>

          <div class="agri-card control-panel__table-card">
            <div class="control-panel__control-head">
              <h3 class="control-panel__card-title">本设备指令记录</h3>
              <span class="control-panel__muted">本次会话 + A09 历史</span>
            </div>
            <AgriTable
              :columns="commandColumns"
              :data="deviceCommandRows"
              :loading="deviceLogsLoading"
              :show-pagination="false"
              empty-text="该设备暂无控制记录"
              row-key="key"
            >
              <template #status="{ row }">
                <AgriStatusTag :status="row.status" :map="CONTROL_STATUS_MAP" />
              </template>
            </AgriTable>
          </div>

          <div class="agri-card control-panel__table-card">
            <div class="control-panel__control-head">
              <h3 class="control-panel__card-title">全站最近控制日志</h3>
              <span class="control-panel__muted">A09 最近 3 条</span>
            </div>
            <AgriTable
              :columns="recentColumns"
              :data="allLogRows.slice(0, 3)"
              :loading="allLogsLoading"
              :show-pagination="false"
              empty-text="暂无控制日志"
              row-key="key"
            >
              <template #status="{ row }">
                <AgriStatusTag :status="row.status" :map="CONTROL_STATUS_MAP" />
              </template>
            </AgriTable>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.control-panel__stats {
  margin-bottom: 16px;
}

.control-panel__layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.control-panel__aside {
  width: 320px;
  flex-shrink: 0;
}

.control-panel__aside-head,
.control-panel__control-head,
.control-panel__device-head,
.control-panel__title-line,
.control-panel__inline,
.control-panel__actions,
.control-panel__lock,
.control-panel__device-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-panel__aside-head,
.control-panel__control-head,
.control-panel__device-head {
  justify-content: space-between;
}

.control-panel__card-title,
.control-panel__device-title {
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.control-panel__device-title {
  font-size: $font-size-lg;
}

.control-panel__muted {
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
}

.control-panel__search {
  margin: 12px 0 10px;
}

.control-panel__types {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.control-panel__device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 580px;
  overflow-y: auto;
}

.control-panel__device {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  background: #fff;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition: all 0.2s;
}

.control-panel__device:hover,
.control-panel__device.is-active {
  border-color: $primary-color;
  box-shadow: 0 0 0 2px rgba(46, 125, 88, 0.12);
}

.control-panel__device-name {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.control-panel__device-meta,
.control-panel__device-code {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.control-panel__device-foot {
  justify-content: space-between;
}

.control-panel__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-panel__lock-label,
.control-panel__label {
  font-size: $font-size-sm;
  color: $text-primary;
}

.control-panel__alert {
  margin-top: -4px;
}

.control-panel__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 0;
}

.control-panel__slider {
  flex: 1;
  min-width: 180px;
  margin: 0 8px;
}

.control-panel__value {
  min-width: 52px;
  font-size: $font-size-sm;
  color: $primary-color;
}

.control-panel__control.is-locked {
  opacity: 0.55;
  filter: grayscale(0.4);
}

.control-panel__actions {
  padding-top: 14px;
  border-top: 1px dashed $border-color;
}

.control-panel__receipt {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-panel__trail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: $bg-page;
  border-radius: $radius-md;
}

.control-panel__trail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: $font-size-xs;
  color: $text-primary;
}

.control-panel__trail-time {
  min-width: 150px;
  color: $text-secondary;
}

.control-panel__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: $text-secondary;
}

.control-panel__dot.is-ok {
  background: $success-color;
}

.control-panel__dot.is-fail {
  background: $danger-color;
}

.control-panel__dot.is-pending {
  background: $warning-color;
}

.control-panel__table-card {
  padding-bottom: 8px;
}

.control-panel__error,
.control-panel__loading {
  padding: 24px 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}

.control-panel__loading {
  cursor: default;
}

@media (max-width: 992px) {
  .control-panel__layout {
    flex-direction: column;
  }

  .control-panel__aside {
    width: 100%;
  }

  .control-panel__device-list {
    max-height: 280px;
  }
}
</style>
