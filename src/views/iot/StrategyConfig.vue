<script setup>
/**
 * P008 策略联动配置
 * 职责：维护「监测指标 + 比较符 + 阈值 + 持续时长 → 执行设备动作」的自动联动策略。
 * 数据：A08 策略列表 / 新增 / 修改；执行设备与地块分别来自 A03、A06。
 * 说明：A08 没有删除接口，删除按演示要求做前端移除 + 二次确认；
 *      启停开关直接改行状态并提示，不额外请求接口。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import {
  createStrategy,
  fetchControlLogs,
  fetchDevices,
  fetchPlots,
  fetchStrategies,
  updateStrategy
} from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useTable } from '@/composables/useTable'

defineOptions({ name: 'StrategyConfigPage' })

// 监测指标字典：阈值范围与单位按指标区分
const METRICS = [
  { value: 'temperature', label: '空气温度', unit: '℃', min: -10, max: 60 },
  { value: 'humidity', label: '空气湿度', unit: '%', min: 0, max: 100 },
  { value: 'soilMoisture', label: '土壤湿度', unit: '%', min: 0, max: 100 },
  { value: 'light', label: '光照', unit: 'lx', min: 0, max: 150000 },
  { value: 'co2', label: 'CO₂', unit: 'ppm', min: 0, max: 5000 }
]

const METRIC_MAP = METRICS.reduce((map, item) => {
  map[item.value] = item
  return map
}, {})

const ENABLED_MAP = {
  启用: { text: '启用', type: 'success' },
  停用: { text: '停用', type: 'info' }
}

const LEVEL_OPTIONS = [
  { label: '紧急', value: 'CRITICAL' },
  { label: '重要', value: 'MAJOR' },
  { label: '一般', value: 'MINOR' }
]

const query = ref({ keyword: '', plotId: '', metric: '', enabled: '' })
const plots = ref([])
const devices = ref([])
const stats = ref({ total: 0, enabled: 0, todayTriggers: 0 })
const statsLoading = ref(false)

const table = useTable(fetchStrategies, { keyword: '', plotId: '', metric: '', enabled: '' })
const { list, loading, pagination, pageSizes } = table
const tableError = ref(false)

const dialogVisible = ref(false)
const dialogMode = ref('create')
const dialogLoading = ref(false)
const dialogRef = ref(null)
const editingId = ref(null)
const dialogDefaults = ref({})
const editData = ref({})
const activeMetric = ref('temperature')
const activeDeviceType = ref('VALVE')

const actuators = computed(() => devices.value.filter((item) => item.category === 'ACTUATOR'))

const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

const deviceOptions = computed(() => [
  ...actuators.value.map((device) => ({
    label: `${device.plotName} · ${device.name}（${device.code}）`,
    value: device.code
  })),
  { label: '不指定设备（仅推送告警）', value: 'NONE' }
])

const metricOptions = METRICS.map((item) => ({
  label: `${item.label}（${item.unit}）`,
  value: item.value
}))

const operatorOptions = [
  { label: '大于 >', value: '>' },
  { label: '小于 <', value: '<' },
  { label: '大于等于 >=', value: '>=' },
  { label: '小于等于 <=', value: '<=' }
]

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '策略名 / 编号 / 地块',
    width: 230
  },
  {
    prop: 'plotId',
    label: '生效地块',
    type: 'select',
    placeholder: '全部地块',
    options: plotOptions.value,
    width: 220
  },
  {
    prop: 'metric',
    label: '监测指标',
    type: 'select',
    placeholder: '全部指标',
    options: metricOptions,
    width: 180
  },
  {
    prop: 'enabled',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '启用', value: 'true' },
      { label: '停用', value: 'false' }
    ],
    width: 130
  }
])

const columns = [
  { prop: 'name', label: '策略名', minWidth: 160, slot: 'name' },
  { prop: 'condition', label: '触发条件', minWidth: 220, slot: 'condition' },
  { prop: 'actionName', label: '执行动作', minWidth: 150, slot: 'actionText' },
  { prop: 'plotName', label: '生效地块', minWidth: 150, showOverflowTooltip: true },
  { prop: 'enabled', label: '状态', width: 90, slot: 'enabled' },
  { prop: 'updatedAt', label: '更新时间', minWidth: 158 },
  { prop: 'ops', label: '操作', width: 200, align: 'center', slot: 'ops' }
]

const statCards = computed(() => [
  { label: '策略总数', value: stats.value.total, unit: '条', icon: 'SetUp', tone: 'brand' },
  { label: '启用中', value: stats.value.enabled, unit: '条', icon: 'CircleCheck', tone: 'ok' },
  {
    label: '今日触发',
    value: stats.value.todayTriggers,
    unit: '次',
    icon: 'Bell',
    tone: 'warn'
  }
])

const thresholdTip = computed(() => {
  const metric = METRIC_MAP[activeMetric.value] || METRICS[0]
  return `取值范围 ${metric.min} ~ ${metric.max} ${metric.unit}`
})

const dialogFields = computed(() => [
  { prop: 'name', label: '策略名', type: 'input', placeholder: '如：高温自动通风', required: true },
  {
    prop: 'plotId',
    label: '生效地块',
    type: 'select',
    placeholder: '请选择地块',
    options: plotOptions.value,
    required: true
  },
  {
    prop: 'metric',
    label: '监测指标',
    type: 'select',
    placeholder: '请选择指标',
    options: metricOptions,
    required: true
  },
  {
    prop: 'operator',
    label: '比较符',
    type: 'select',
    placeholder: '请选择',
    options: operatorOptions,
    required: true
  },
  {
    prop: 'threshold',
    label: '阈值',
    type: 'number',
    placeholder: '请输入阈值',
    required: true,
    tip: thresholdTip.value
  },
  {
    prop: 'duration',
    label: '持续时长',
    type: 'number',
    placeholder: '1 ~ 120 分钟',
    required: true,
    tip: '单位：分钟'
  },
  {
    prop: 'deviceCode',
    label: '执行设备',
    type: 'select',
    placeholder: '请选择执行设备',
    options: deviceOptions.value,
    required: true
  },
  {
    prop: 'action',
    label: '执行动作',
    type: 'select',
    placeholder: '请选择动作',
    options: actionsForType(activeDeviceType.value),
    required: true
  },
  {
    prop: 'level',
    label: '告警级别',
    type: 'select',
    placeholder: '请选择',
    options: LEVEL_OPTIONS,
    required: true
  },
  {
    prop: 'remark',
    label: '备注',
    type: 'textarea',
    placeholder: '选填，说明策略用途',
    span: 2
  }
])

/**
 * 按执行设备类型返回可选动作。
 * @param {string} type 设备类型（VALVE/FAN/LIGHT/CURTAIN/NONE）
 * @returns {Array<{label:string,value:string}>} 动作选项
 */
function actionsForType(type) {
  if (type === 'VALVE') {
    return [
      { label: '开启阀门', value: 'OPEN' },
      { label: '关闭阀门', value: 'CLOSE' }
    ]
  }
  if (type === 'FAN') {
    return [
      { label: '开启风机', value: 'ON' },
      { label: '关闭风机', value: 'OFF' }
    ]
  }
  if (type === 'LIGHT') {
    return [
      { label: '开启补光', value: 'ON' },
      { label: '关闭补光', value: 'OFF' }
    ]
  }
  if (type === 'CURTAIN') {
    return [
      { label: '升起卷帘', value: 'OPEN' },
      { label: '停止卷帘', value: 'SET_MODE' },
      { label: '降下卷帘', value: 'CLOSE' }
    ]
  }
  if (type === 'NONE') {
    return [{ label: '仅推送告警', value: 'SEND_ALARM' }]
  }
  return [
    { label: '开机', value: 'ON' },
    { label: '停机', value: 'OFF' }
  ]
}

/**
 * 从策略动作反推执行设备类型，供编辑回填。
 * @param {string} action 动作编码
 * @returns {string} 设备类型
 */
function actuatorTypeFromAction(action) {
  const code = String(action || '')
  if (code.includes('VALVE')) {
    return 'VALVE'
  }
  if (code.includes('FAN')) {
    return 'FAN'
  }
  if (code.includes('LIGHT')) {
    return 'LIGHT'
  }
  if (code.includes('CURTAIN')) {
    return 'CURTAIN'
  }
  return 'NONE'
}

/** 指标单位 */
function unitOf(metric) {
  return METRIC_MAP[metric]?.unit || ''
}

/** 指标中文名 */
function metricNameOf(metric) {
  return METRIC_MAP[metric]?.label || metric
}

/**
 * 触发条件文案：如「空气温度 > 32℃ · 持续 10 分钟」。
 * @param {Object} row 策略行
 * @returns {string} 文案
 */
function conditionText(row) {
  return `${row.metricName || metricNameOf(row.metric)} ${row.operator} ${row.threshold}${unitOf(row.metric)} · 持续 ${row.duration} 分钟`
}

/**
 * 阈值校验：按当前指标区间校验，避免温度用湿度范围。
 * @param {Object} rule 校验规则
 * @param {*} value 输入值
 * @param {Function} callback 回调
 */
function validateThreshold(rule, value, callback) {
  if (value === null || value === undefined || value === '') {
    callback(new Error('请输入阈值'))
    return
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    callback(new Error('阈值必须为数字'))
    return
  }
  const metric = METRIC_MAP[activeMetric.value] || METRICS[0]
  if (number < metric.min || number > metric.max) {
    callback(new Error(`${metric.label}阈值需在 ${metric.min} ~ ${metric.max} 之间`))
    return
  }
  callback()
}

const dialogRules = computed(() => ({
  name: [
    { required: true, message: '请输入策略名', trigger: 'blur' },
    { max: 20, message: '策略名不能超过 20 个字', trigger: 'blur' }
  ],
  plotId: [{ required: true, message: '请选择生效地块', trigger: 'change' }],
  metric: [{ required: true, message: '请选择监测指标', trigger: 'change' }],
  operator: [{ required: true, message: '请选择比较符', trigger: 'change' }],
  threshold: [
    { required: true, message: '请输入阈值', trigger: 'blur' },
    { validator: validateThreshold, trigger: 'blur' }
  ],
  duration: [
    { required: true, message: '请输入持续时长', trigger: 'blur' },
    { type: 'number', min: 1, max: 120, message: '持续时长需在 1 ~ 120 分钟之间', trigger: 'blur' }
  ],
  deviceCode: [{ required: true, message: '请选择执行设备', trigger: 'change' }],
  action: [{ required: true, message: '请选择执行动作', trigger: 'change' }],
  level: [{ required: true, message: '请选择告警级别', trigger: 'change' }]
}))

/** 载入地块下拉 */
async function loadPlots() {
  try {
    const data = await fetchPlots({ page: 1, size: 100 })
    plots.value = data?.list || []
  } catch {
    plots.value = []
  }
}

/** 载入执行设备下拉：沿用 A03 全量后按 category 过滤 */
async function loadDevices() {
  try {
    const data = await fetchDevices({ page: 1, size: 100 })
    devices.value = data?.list || []
  } catch {
    devices.value = []
  }
}

/** 载入顶部统计：A08 全量 + A09 策略联动日志 */
async function loadStats() {
  statsLoading.value = true
  try {
    const [strategyData, logData] = await Promise.all([
      fetchStrategies({ page: 1, size: 100 }),
      fetchControlLogs({ page: 1, size: 100 })
    ])
    const rows = strategyData?.list || []
    const logs = logData?.list || []
    const latestDay = logs[0]?.createdAt ? String(logs[0].createdAt).slice(0, 10) : ''
    stats.value = {
      total: strategyData?.total ?? rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      todayTriggers: logs.filter(
        (log) =>
          log.source === 'STRATEGY' && latestDay && String(log.createdAt).startsWith(latestDay)
      ).length
    }
  } catch {
    stats.value = { total: 0, enabled: 0, todayTriggers: 0 }
  } finally {
    statsLoading.value = false
  }
}

/** 载入列表；40401 按空态处理 */
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
 * 查询：把搜索栏条件写入表格过滤并回到第 1 页。
 * @param {Object} [payload] 搜索栏条件
 */
function handleSearch(payload) {
  const source = payload || query.value
  table.filters.keyword = source.keyword || ''
  table.filters.plotId = source.plotId || ''
  table.filters.metric = source.metric || ''
  table.filters.enabled = source.enabled || ''
  table.search().catch((err) => {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  })
}

/** 重置搜索条件 */
function handleReset() {
  query.value = { keyword: '', plotId: '', metric: '', enabled: '' }
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

/** 打开新建弹窗：默认选中第一个执行器与空气温度 */
function openCreate() {
  const firstDevice = actuators.value[0]
  dialogMode.value = 'create'
  editingId.value = null
  activeMetric.value = 'temperature'
  activeDeviceType.value = firstDevice?.type || 'VALVE'
  dialogDefaults.value = {
    plotId: plots.value[0]?.id || '',
    metric: 'temperature',
    operator: '>',
    threshold: null,
    duration: 10,
    deviceCode: firstDevice?.code || 'NONE',
    action: actionsForType(activeDeviceType.value)[0]?.value || 'ON',
    level: 'MAJOR',
    remark: ''
  }
  editData.value = {}
  dialogVisible.value = true
}

/**
 * 打开编辑弹窗：按动作反推执行设备类型，回填设备与动作。
 * @param {Object} row 策略行
 */
function openEdit(row) {
  const type = actuatorTypeFromAction(row.action)
  const device =
    actuators.value.find((item) => item.type === type) ||
    (type === 'NONE' ? null : actuators.value[0])
  dialogMode.value = 'edit'
  editingId.value = row.id
  activeMetric.value = row.metric || 'temperature'
  activeDeviceType.value = device?.type || 'NONE'
  dialogDefaults.value = {
    plotId: row.plotId,
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    duration: row.duration,
    deviceCode: device?.code || 'NONE',
    action: actionsForType(activeDeviceType.value).some((item) => item.value === row.action)
      ? row.action
      : actionsForType(activeDeviceType.value)[0]?.value,
    level: row.level || 'MAJOR',
    remark: row.remark || ''
  }
  editData.value = { ...row, deviceCode: device?.code || 'NONE' }
  dialogVisible.value = true
}

/**
 * 表单字段联动：指标变化刷新阈值范围，设备变化重置动作选项。
 * @param {{prop:string,value:*}} payload 字段变化
 */
function handleFieldChange({ prop, value }) {
  if (prop === 'metric') {
    activeMetric.value = value
    return
  }
  if (prop === 'deviceCode') {
    const device = actuators.value.find((item) => item.code === value)
    activeDeviceType.value = value === 'NONE' ? 'NONE' : device?.type || 'VALVE'
    const options = actionsForType(activeDeviceType.value)
    const currentAction = dialogRef.value?.getForm?.().action
    if (!options.some((item) => item.value === currentAction)) {
      dialogRef.value?.setField('action', options[0]?.value)
    }
  }
}

/** 提交新建或编辑 */
async function handleDialogSubmit(payload) {
  const device = actuators.value.find((item) => item.code === payload.deviceCode)
  if (!device && payload.deviceCode !== 'NONE') {
    ElMessage.warning('请选择有效的执行设备')
    return
  }
  const metric = METRIC_MAP[payload.metric] || METRICS[0]
  const actionOptions = actionsForType(activeDeviceType.value)
  const action = actionOptions.find((item) => item.value === payload.action)
  const plot = plots.value.find((item) => item.id === payload.plotId)
  const body = {
    name: String(payload.name || '').trim(),
    plotId: payload.plotId,
    plotName: plot?.name || '',
    metric: payload.metric,
    metricName: metric.label,
    operator: payload.operator,
    threshold: Number(payload.threshold),
    duration: Number(payload.duration),
    deviceType: device?.type || '',
    action: payload.action,
    actionName: action?.label || payload.action,
    level: payload.level || 'MAJOR',
    remark: payload.remark || ''
  }

  dialogLoading.value = true
  try {
    if (dialogMode.value === 'create') {
      const created = await createStrategy({ ...body, enabled: true, priority: 5 })
      if (pagination.page === 1) {
        list.value.unshift({ ...created, plotName: created.plotName || plot?.name || '' })
        pagination.total += 1
      } else {
        pagination.page = 1
        await table.loadData()
      }
      ElMessage.success('策略创建成功')
    } else {
      const current = list.value.find((item) => item.id === editingId.value)
      const updated = await updateStrategy(editingId.value, {
        ...body,
        enabled: current?.enabled ?? true,
        priority: current?.priority ?? 5
      })
      const index = list.value.findIndex((item) => item.id === editingId.value)
      if (index >= 0) {
        list.value.splice(index, 1, { ...list.value[index], ...body, ...updated })
      }
      ElMessage.success('策略更新成功')
    }
    dialogVisible.value = false
    loadStats()
  } catch (err) {
    if (err?.code === 40901) {
      ElMessage.closeAll()
      ElMessage.warning('策略已发生变化，请刷新后重试')
    }
  } finally {
    dialogLoading.value = false
  }
}

/**
 * 启停策略：按演示要求直接改本地行状态，并同步顶部统计。
 * @param {Object} row 策略行
 */
function toggleStrategy(row) {
  row.enabled = !row.enabled
  stats.value.enabled += row.enabled ? 1 : -1
  ElMessage.success(row.enabled ? `策略「${row.name}」已启用` : `策略「${row.name}」已停用`)
}

/**
 * 删除策略：二次确认后本地移除（A08 无 DELETE 接口）。
 * @param {Object} row 策略行
 */
async function removeStrategy(row) {
  try {
    await ElMessageBox.confirm(`确认删除策略「${row.name}」？删除后不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  const index = list.value.findIndex((item) => item.id === row.id)
  if (index < 0) {
    return
  }
  list.value.splice(index, 1)
  pagination.total = Math.max(0, pagination.total - 1)
  stats.value.total = Math.max(0, stats.value.total - 1)
  if (row.enabled) {
    stats.value.enabled = Math.max(0, stats.value.enabled - 1)
  }
  ElMessage.success('策略已删除')
  if (!list.value.length && pagination.page > 1) {
    handlePageChange({ page: pagination.page - 1, size: pagination.size })
  }
}

onMounted(async () => {
  await Promise.all([loadPlots(), loadDevices()])
  await Promise.all([loadList(), loadStats()])
})
</script>

<template>
  <div class="page-container strategy-config">
    <AgriPageHeader
      page-id="P008"
      title="策略联动配置"
      description="配置环境指标触发条件与执行动作，实现温室设备自动联动。"
    >
      <template #extra>
        <el-button type="primary" @click="openCreate">新建策略</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="strategy-config__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="8">
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

    <div class="agri-card strategy-config__search">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card">
      <div v-if="tableError" class="strategy-config__error" @click="loadList">
        加载失败，点击重试
      </div>
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
        empty-text="暂无联动策略"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
      >
        <template #name="{ row }">
          <div class="strategy-config__name">{{ row.name }}</div>
          <div class="strategy-config__sub">{{ row.strategyNo }}</div>
        </template>
        <template #condition="{ row }">
          <span class="strategy-config__condition">{{ conditionText(row) }}</span>
        </template>
        <template #actionText="{ row }">
          {{ row.actionName }}
        </template>
        <template #enabled="{ row }">
          <AgriStatusTag :status="row.enabled ? '启用' : '停用'" :map="ENABLED_MAP" />
        </template>
        <template #ops="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" @click="toggleStrategy(row)">
            {{ row.enabled ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="removeStrategy(row)">删除</el-button>
        </template>
      </AgriTable>
    </div>

    <AgriFormDialog
      ref="dialogRef"
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建联动策略' : '编辑联动策略'"
      :fields="dialogFields"
      :rules="dialogRules"
      :default-values="dialogDefaults"
      :edit-data="editData"
      :loading="dialogLoading"
      width="760"
      @field-change="handleFieldChange"
      @submit="handleDialogSubmit"
    />
  </div>
</template>

<style scoped lang="scss">
.strategy-config__stats {
  margin-bottom: 16px;
}

.strategy-config__search {
  margin-bottom: 16px;
}

.strategy-config__name {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.strategy-config__sub {
  margin-top: 2px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.strategy-config__condition {
  color: $text-primary;
}

.strategy-config__error {
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}
</style>
