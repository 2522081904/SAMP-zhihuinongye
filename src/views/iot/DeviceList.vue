<script setup>
/**
 * P005 设备总览
 * 职责：按关键词 / 类型 / 在线状态 / 地块检索设备台账（A03），
 *      顶部汇总设备总数、在线数、离线数与存在待处置告警的设备数，
 *      支持前端导出 CSV（不新增依赖）。
 * 交互约定：查询、重置、翻页、改每页条数都必须真实重新请求；
 *          错误在页面内以「加载失败，点击重试」呈现，40401 按空态静默处理。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { fetchAlarms, fetchDevices, fetchPlots } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { useTable } from '@/composables/useTable'

defineOptions({ name: 'DeviceListPage' })

const route = useRoute()
const router = useRouter()

// 搜索栏双向绑定值
const query = ref({ keyword: '', type: '', status: '', plotId: '' })

// 地块下拉数据
const plots = ref([])
const plotsLoading = ref(false)

// 设备类型下拉：以设备台账返回的 type/typeName 为准，避免前端重复维护字典
const deviceTypes = ref([])

// 顶部统计
const stats = ref({ total: 0, online: 0, offline: 0, alarmDevices: 0 })
const statsLoading = ref(false)
const statsError = ref(false)

// 设备列表（接口分页）
const table = useTable(fetchDevices, { keyword: '', type: '', status: '', plotId: '' })
const { list, loading, pagination, pageSizes } = table
const tableError = ref(false)
const exporting = ref(false)

const typeOptions = computed(() =>
  deviceTypes.value.map((item) => ({ label: item.label, value: item.value }))
)

const statusOptions = [
  { label: '在线', value: 'ONLINE' },
  { label: '离线', value: 'OFFLINE' },
  { label: '故障', value: 'FAULT' }
]

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '设备编号 / 名称 / 地块 / 厂商',
    width: 260
  },
  {
    prop: 'type',
    label: '设备类型',
    type: 'select',
    placeholder: '全部类型',
    options: typeOptions.value,
    width: 190
  },
  {
    prop: 'status',
    label: '在线状态',
    type: 'select',
    placeholder: '全部状态',
    options: statusOptions,
    width: 150
  },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id })),
    width: 220
  }
])

const columns = [
  { prop: 'code', label: '设备编号', minWidth: 160, showOverflowTooltip: true },
  { prop: 'name', label: '设备名称', minWidth: 160, showOverflowTooltip: true },
  { prop: 'typeName', label: '设备类型', minWidth: 140 },
  { prop: 'plotName', label: '所属地块', minWidth: 160, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'lastSeen', label: '最后上报', minWidth: 170 },
  { prop: 'action', label: '操作', width: 160, align: 'center', slot: 'action' }
]

// 四张统计卡：数值随统计接口刷新
const statCards = computed(() => [
  {
    label: '设备总数',
    value: stats.value.total,
    unit: '台',
    icon: 'Monitor',
    tone: 'brand'
  },
  {
    label: '在线设备',
    value: stats.value.online,
    unit: '台',
    icon: 'Connection',
    tone: 'ok'
  },
  {
    label: '离线设备',
    value: stats.value.offline,
    unit: '台',
    icon: 'SwitchButton',
    tone: 'warn'
  },
  {
    label: '告警设备',
    value: stats.value.alarmDevices,
    unit: '台',
    icon: 'Warning',
    tone: 'danger'
  }
])

/**
 * 汇总类型字典：A03 一次拉 100 台足够覆盖当前农场设备规模。
 * 失败不阻断页面，只让类型下拉退化为空。
 */
async function loadDeviceTypes() {
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
  }
}

/** 载入地块下拉 */
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
 * 载入顶部统计：
 * 设备总量取 A03 的 total；在线/离线按状态字段在前端统计（一次拉全量）；
 * 告警设备数取 A19 待处置告警里去重后的设备编码数量。
 */
async function loadStats() {
  statsLoading.value = true
  statsError.value = false
  try {
    const [deviceData, alarmData] = await Promise.all([
      fetchDevices({ page: 1, size: 100 }),
      fetchAlarms({ page: 1, size: 100, status: 'PENDING' })
    ])
    const devices = deviceData?.list || []
    const alarmCodes = new Set((alarmData?.list || []).map((alarm) => alarm.deviceCode))
    stats.value = {
      total: deviceData?.total ?? devices.length,
      online: devices.filter((device) => device.status === 'ONLINE').length,
      offline: devices.filter((device) => device.status !== 'ONLINE').length,
      alarmDevices: alarmCodes.size
    }
  } catch (err) {
    if (err?.code !== 40401) {
      statsError.value = true
    }
  } finally {
    statsLoading.value = false
  }
}

/** 载入设备列表：沿用当前页码，回第 1 页由 handleSearch 负责 */
async function loadDevices() {
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
 * 查询：把搜索栏条件写进表格过滤条件并回到第 1 页重新请求。
 * @param {Object} [payload] 搜索栏抛出的条件快照
 */
function handleSearch(payload) {
  const source = payload || query.value
  table.filters.keyword = source.keyword || ''
  table.filters.type = source.type || ''
  table.filters.status = source.status || ''
  table.filters.plotId = source.plotId || ''
  tableError.value = false
  table.search().catch((err) => {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  })
}

/** 重置：清空搜索条件并重新请求 */
function handleReset() {
  query.value = { keyword: '', type: '', status: '', plotId: '' }
  handleSearch(query.value)
}

/**
 * 翻页：更新分页状态后真实请求下一页。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handlePageChange(payload) {
  try {
    await table.onPageChange(payload)
  } catch (err) {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  }
}

/**
 * 改每页条数：回到第 1 页并真实请求。
 * @param {{page:number,size:number}} payload 分页事件
 */
async function handleSizeChange(payload) {
  try {
    await table.onSizeChange(payload)
  } catch (err) {
    if (err?.code !== 40401) {
      tableError.value = true
    }
  }
}

/** 跳转设备详情 */
function goDetail(row) {
  router.push({ path: '/iot/devices/detail', query: { code: row.code } })
}

/** 跳转远程控制 */
function goControl(row) {
  router.push({ path: '/iot/control', query: { device: row.code } })
}

/** 重试：统计与列表一起重拉 */
function retryAll() {
  loadStats()
  loadDevices()
}

/**
 * CSV 单元格转义：统一加引号，内部引号双写，避免逗号/换行破坏列结构。
 * @param {*} value 原始值
 * @returns {string} 转义后的单元格
 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 前端生成 CSV 并用 Blob 触发下载（不新增依赖）。
 * 加 UTF-8 BOM，保证 Excel 直接打开中文不乱码。
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

/**
 * 导出 CSV：按当前已生效的检索条件取全量（max 100 台）后前端生成文件。
 */
async function handleExport() {
  if (exporting.value) {
    return
  }
  exporting.value = true
  try {
    const data = await fetchDevices({ ...query.value, page: 1, size: 100 })
    const rows = (data?.list || []).map((device) => [
      device.code,
      device.name,
      device.typeName,
      device.plotName,
      device.statusName,
      device.lastSeen,
      device.signal
    ])
    if (!rows.length) {
      ElMessage.warning('当前条件下没有可导出的设备')
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(
      `设备台账_${stamp}.csv`,
      ['设备编号', '设备名称', '设备类型', '所属地块', '状态', '最后上报时间', '信号强度'],
      rows
    )
    ElMessage.success(`已导出 ${rows.length} 条设备`)
  } catch {
    // 失败提示由 request.js 拦截器统一弹出
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  // 顶栏全局搜索会带 ?keyword= 跳到本页，这里接管为初始查询条件
  const keyword = typeof route.query.keyword === 'string' ? route.query.keyword : ''
  if (keyword) {
    query.value.keyword = keyword
  }
  loadPlots()
  loadDeviceTypes()
  loadStats()
  handleSearch(query.value)
})

// 已在本页时再次使用顶栏搜索（route.query 变化但组件不重建），同样要生效
watch(
  () => route.query.keyword,
  (value) => {
    const keyword = typeof value === 'string' ? value : ''
    query.value.keyword = keyword
    handleSearch(query.value)
  }
)
</script>

<template>
  <div class="page-container device-list">
    <AgriPageHeader
      page-id="P005"
      title="设备总览"
      description="按关键词、类型、在线状态与地块检索设备台账，支持查看详情、跳转远程控制与导出 CSV。"
    >
      <template #extra>
        <el-button :loading="statsLoading" @click="retryAll">刷新</el-button>
        <el-button type="primary" :loading="exporting" @click="handleExport">导出 CSV</el-button>
      </template>
    </AgriPageHeader>

    <!-- 统计卡：失败显示可点击重试的错误态 -->
    <div v-if="statsError" class="device-list__error" @click="retryAll">加载失败，点击重试</div>
    <el-row v-else :gutter="16" class="device-list__stats">
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

    <!-- 查询条件 -->
    <div class="agri-card device-list__section">
      <AgriSearchBar
        :model-value="query"
        :fields="searchFields"
        :loading="plotsLoading"
        @update:model-value="query = $event"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <!-- 设备台账 -->
    <div class="agri-card device-list__section">
      <div class="device-list__section-head">
        <h3 class="device-list__section-title">设备台账</h3>
        <span class="text-secondary">共 {{ pagination.total }} 台设备</span>
      </div>
      <div v-if="tableError" class="device-list__error" @click="loadDevices">
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
        row-key="code"
        empty-text="暂无匹配设备，试试调整筛选条件"
        @page-change="handlePageChange"
        @size-change="handleSizeChange"
      >
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" @click="goDetail(row)">详情</el-button>
          <el-button link type="primary" @click="goControl(row)">远程控制</el-button>
        </template>
      </AgriTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.device-list__stats {
  margin-bottom: $space-md;
}

// 指标卡在窄屏换行时保留纵向间距
.device-list__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.device-list__section {
  margin-bottom: $space-md;
}

.device-list__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.device-list__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

// 统一错误态：虚线框 + 危险色文字，点击即重试
.device-list__error {
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
  .device-list__section-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
