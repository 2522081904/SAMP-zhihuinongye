<script setup>
/**
 * P021 溯源批次与二维码生成
 * 数据来源：A15 采收批次（GET /harvest/batches）、A16 溯源码（GET /trace/codes、
 *           POST /trace/codes、GET /trace/batches/{batchNo}/codes）。
 * 数据缺口与限制：
 * - A16 只有单码累计扫码次数，没有「按月扫码」口径，本月扫码次数用固定演示值并在此说明；
 * - A15 / A16 都没有「应赋码数量」字段，页面按 5 kg/件 的包装规格估算应赋码量，
 *   用于区分「未赋码 / 部分赋码 / 已赋码」，仅供演示；
 * - A16 种子每批次只放 1 条样本码，与批次 traceCodeCount（3~6）不一致，
 *   页面统一以 A16 明细计数为准，生成后回源刷新；
 * - A16 没有「标记打印」接口，打印状态只读展示 printed 字段。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  fetchBatchTraceCodes,
  fetchHarvestBatches,
  fetchPlots,
  fetchTraceCodes,
  generateTraceCodes
} from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'TraceBatchPage' })

// A16 无按月扫码接口，本月扫码次数取固定演示值（口径见文件头注释）
const DEMO_MONTH_SCAN_COUNT = 1286
// 演示用包装规格：5 kg/件，用于估算每批次应赋码数量
const PACKAGE_KG = 5
// 演示二维码矩阵边长（25×25，含三个 7×7 定位角）
const QR_SIZE = 25
// 单次生成上限（A16 约定）
const MAX_GENERATE = 100

// 检测状态：AgriStatusTag 内置的 PENDING 是「待处置」，必须传业务态 map
const INSPECT_STATUS_MAP = {
  PENDING: { text: '待检测', type: 'warning' },
  INSPECTING: { text: '检测中', type: 'primary' },
  QUALIFIED: { text: '合格', type: 'success' },
  REJECTED: { text: '不合格', type: 'danger' }
}

// 赋码状态
const TRACE_STATE_MAP = {
  NONE: { text: '未赋码', type: 'info' },
  PARTIAL: { text: '部分赋码', type: 'warning' },
  FULL: { text: '已赋码', type: 'success' }
}

// 码打印状态（A16 无标记接口，只读展示）
const PRINTED_MAP = {
  PRINTED: { text: '已打印', type: 'success' },
  UNPRINTED: { text: '未打印', type: 'info' }
}

const query = ref({ keyword: '', plotId: '', inspectStatus: '', traceState: '' })
const page = ref(1)
const size = ref(10)
const batches = ref([])
const plots = ref([])
const codeList = ref([])
const codeTotal = ref(0)
const loading = ref(false)
const loadError = ref(false)

const selectedBatchNo = ref('')
const panelRef = ref(null)
const panelLoading = ref(false)
const panelCodes = ref([])
const panelPage = ref(1)
const panelSize = ref(20)
const genCount = ref(20)
const genLoading = ref(false)

const previewVisible = ref(false)
const previewCode = ref('')
const previewLoading = ref(false)
const previewBatchNo = ref('')

// 打印模式：'' 不打印 / 'panel' 只打印单码面板 / 'grid' 打印批次前 12 个码
const printMode = ref('')

const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '批次号 / 作物 / 地块',
    width: 240
  },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plotOptions.value,
    width: 220
  },
  {
    prop: 'inspectStatus',
    label: '检测状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '待检测', value: 'PENDING' },
      { label: '检测中', value: 'INSPECTING' },
      { label: '合格', value: 'QUALIFIED' },
      { label: '不合格', value: 'REJECTED' }
    ],
    width: 140
  },
  {
    prop: 'traceState',
    label: '赋码状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '未赋码', value: 'NONE' },
      { label: '部分赋码', value: 'PARTIAL' },
      { label: '已赋码', value: 'FULL' }
    ],
    width: 140
  }
])

// 列宽合计约 1028px，控制在 1060px 内，避免 1440 视口下横向截断
const columns = [
  { prop: 'batchNo', label: '批次号', width: 132 },
  { prop: 'plotName', label: '地块', width: 100, showOverflowTooltip: true },
  { prop: 'crop', label: '作物', width: 76 },
  { prop: 'harvestDate', label: '采收日期', width: 104 },
  { prop: 'quantityKg', label: '重量(kg)', width: 90, slot: 'quantityKg' },
  { prop: 'status', label: '检测状态', width: 92, slot: 'status' },
  { prop: 'codeCount', label: '溯源码数量', width: 96, slot: 'codeCount', align: 'center' },
  { prop: 'traceState', label: '赋码状态', width: 96, slot: 'traceState' },
  { prop: 'action', label: '操作', width: 240, slot: 'action', align: 'center' }
]

// 码列表列配置
const codeColumns = [
  { prop: 'code', label: '溯源码', width: 170, slot: 'code' },
  { prop: 'createdAt', label: '生成时间', width: 176 },
  { prop: 'printed', label: '打印状态', width: 100, slot: 'printed' },
  { prop: 'action', label: '操作', width: 96, slot: 'codeAction', align: 'center' }
]

/** 每批次实际已生成的码数（以 A16 明细为准） */
const codeCountMap = computed(() => {
  const map = new Map()
  codeList.value.forEach((item) => {
    map.set(item.batchNo, (map.get(item.batchNo) || 0) + 1)
  })
  return map
})

/**
 * 估算批次应赋码数量：按 5 kg/件 包装规格向上取整，最少 1 件。
 * @param {Object} batch 采收批次
 * @returns {number} 应赋码数量
 */
function plannedCodeCount(batch) {
  return Math.max(1, Math.ceil(Number(batch.quantityKg || 0) / PACKAGE_KG))
}

/** 批发行数据：补充实际码数、应赋码数与赋码状态 */
const rows = computed(() =>
  batches.value.map((batch) => {
    const codeCount = codeCountMap.value.get(batch.batchNo) || 0
    const plannedCount = plannedCodeCount(batch)
    let traceState = 'PARTIAL'
    if (codeCount === 0) {
      traceState = 'NONE'
    } else if (codeCount >= plannedCount) {
      traceState = 'FULL'
    }
    return { ...batch, codeCount, plannedCount, traceState }
  })
)

const filteredRows = computed(() => {
  const keyword = query.value.keyword.trim().toLowerCase()
  return rows.value.filter((row) => {
    const matchKeyword =
      !keyword ||
      [row.batchNo, row.crop, row.plotName].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchPlot = !query.value.plotId || row.plotId === query.value.plotId
    const matchInspect = !query.value.inspectStatus || row.status === query.value.inspectStatus
    const matchTrace = !query.value.traceState || row.traceState === query.value.traceState
    return matchKeyword && matchPlot && matchInspect && matchTrace
  })
})

const pagedRows = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredRows.value.slice(start, start + size.value)
})

const stats = computed(() => ({
  total: rows.value.length,
  coded: rows.value.filter((row) => row.traceState === 'FULL').length,
  codes: codeTotal.value,
  scans: DEMO_MONTH_SCAN_COUNT
}))

const statCards = computed(() => [
  { label: '可赋码批次', value: stats.value.total, unit: '批', icon: 'Files', tone: 'brand' },
  { label: '已赋码批次', value: stats.value.coded, unit: '批', icon: 'Select', tone: 'ok' },
  { label: '溯源码总数', value: stats.value.codes, unit: '个', icon: 'Link', tone: 'brand' },
  { label: '本月扫码次数', value: stats.value.scans, unit: '次', icon: 'View', tone: 'warn' }
])

const selectedRow = computed(
  () => rows.value.find((row) => row.batchNo === selectedBatchNo.value) || null
)

/** 面板中按生成时间倒序（A16 新码在最前，这里再显式排序一次保证稳定） */
const panelPagedCodes = computed(() => {
  const start = (panelPage.value - 1) * panelSize.value
  return panelCodes.value.slice(start, start + panelSize.value)
})

/** 批量打印固定取前 12 个码（3 列 × 4 行） */
const printGridCodes = computed(() => panelCodes.value.slice(0, 12))

const firstPanelCode = computed(() => panelCodes.value[0]?.code || '')

const emptyText = computed(() => {
  const hasFilter =
    query.value.keyword || query.value.plotId || query.value.inspectStatus || query.value.traceState
  if (hasFilter) {
    return '暂无匹配批次；「已赋码」需生成数量达到估算应赋码量，可先选其他筛选条件'
  }
  return '暂无可赋码批次'
})

/**
 * 逐页拉取全部溯源码（A16 单页上限 100），保证每批次码数统计准确。
 * 演示数据量有限，最多拉 10 页（1000 个码）后停止。
 * @returns {Promise<void>}
 */
async function loadCodes() {
  const collected = []
  let current = 1
  let total = 0
  while (current <= 10) {
    const data = await fetchTraceCodes({ page: current, size: 100 })
    const list = data?.list || []
    total = Number(data?.total ?? list.length)
    collected.push(...list)
    if (!list.length || collected.length >= total) {
      break
    }
    current += 1
  }
  codeList.value = collected
  codeTotal.value = total
}

/**
 * 载入批次、地块与全部溯源码。
 * 注意：mock 适配器返回 db 内对象引用，写操作后必须回源刷新，不能本地累加。
 * @returns {Promise<void>}
 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [batchData, plotData] = await Promise.all([
      fetchHarvestBatches({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 100 })
    ])
    batches.value = batchData?.list || []
    plots.value = plotData?.list || []
    await loadCodes()
    if (!selectedBatchNo.value && rows.value.length) {
      // 首次进入默认选中第一个批次，便于直接看到二维码面板
      await loadPanelCodes(rows.value[0].batchNo)
      selectedBatchNo.value = rows.value[0].batchNo
    } else if (selectedBatchNo.value) {
      await loadPanelCodes(selectedBatchNo.value)
    }
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/**
 * 拉取指定批次的全部溯源码（A16 批次码接口不分页）。
 * @param {string} batchNo 批次号
 * @returns {Promise<void>}
 */
async function loadPanelCodes(batchNo) {
  if (!batchNo) {
    return
  }
  panelLoading.value = true
  try {
    const data = await fetchBatchTraceCodes(batchNo)
    panelCodes.value = [...(data?.list || [])].sort((left, right) => right.id - left.id)
    panelPage.value = 1
  } catch (err) {
    if (err?.code === 40401) {
      panelCodes.value = []
    } else {
      ElMessage.error('溯源码列表加载失败，请稍后重试')
    }
  } finally {
    panelLoading.value = false
  }
}

/**
 * 选中批次：加载码列表并滚动到二维码面板。
 * @param {Object} row 批次行
 * @returns {Promise<void>}
 */
async function selectBatch(row) {
  if (!row) {
    return
  }
  selectedBatchNo.value = row.batchNo
  await loadPanelCodes(row.batchNo)
  nextTick(() => {
    panelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function handleSearch() {
  page.value = 1
}

function handleReset() {
  query.value = { keyword: '', plotId: '', inspectStatus: '', traceState: '' }
  page.value = 1
}

function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

function handlePanelPageChange(payload) {
  panelPage.value = payload.page
  panelSize.value = payload.size
}

/**
 * 生成溯源码：A16 单次 1~100；成功后回源刷新（服务端会累加批次计数并写入新码）。
 * @returns {Promise<void>}
 */
async function handleGenerate() {
  const batch = selectedRow.value
  if (!batch || genLoading.value) {
    return
  }
  const count = Number(genCount.value)
  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATE) {
    ElMessage.warning(`溯源码数量需为 1~${MAX_GENERATE} 的整数`)
    return
  }
  genLoading.value = true
  try {
    await generateTraceCodes({ batchNo: batch.batchNo, count })
    // mock 返回的是库内对象引用，A16 已在服务端累加；这里重新拉取，禁止本地累加
    await loadAll()
    ElMessage.success(`已生成 ${count} 个溯源码`)
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.error('采收批次不存在，请刷新后重试')
    }
  } finally {
    genLoading.value = false
  }
}

/** 打开扫码预览弹窗 */
async function openPreview(row) {
  previewBatchNo.value = row.batchNo
  previewCode.value = ''
  previewVisible.value = true
  previewLoading.value = true
  try {
    const data = await fetchBatchTraceCodes(row.batchNo)
    previewCode.value = data?.list?.[0]?.code || ''
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('预览加载失败，请稍后重试')
    }
  } finally {
    previewLoading.value = false
  }
}

/**
 * 复制文本到剪贴板：优先 Clipboard API，失败时降级为 textarea + execCommand。
 * @param {string} text 待复制文本
 * @returns {Promise<boolean>} 是否复制成功
 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 非安全上下文可能直接抛错，继续走降级方案
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  document.body.removeChild(textarea)
  return copied
}

/**
 * 复制溯源码并提示结果。
 * @param {string} code 溯源码
 * @returns {Promise<void>}
 */
async function copyCode(code) {
  if (!code) {
    ElMessage.warning('暂无可复制的溯源码')
    return
  }
  const copied = await copyText(code)
  if (copied) {
    ElMessage.success(`已复制溯源码 ${code}`)
  } else {
    ElMessage.error('复制失败，请手动选中码值复制')
  }
}

/**
 * 打印单码二维码：@media print 下只保留二维码面板，打印结束恢复页面。
 * @returns {Promise<void>}
 */
async function printPanel() {
  if (!panelCodes.value.length) {
    ElMessage.warning('该批次尚未生成溯源码')
    return
  }
  printMode.value = 'panel'
  await nextTick()
  window.print()
  printMode.value = ''
}

/**
 * 批量打印批次二维码：固定前 12 个码，3 列 × 4 行。
 * @returns {Promise<void>}
 */
async function printGrid() {
  if (!panelCodes.value.length) {
    ElMessage.warning('该批次尚未生成溯源码')
    return
  }
  printMode.value = 'grid'
  await nextTick()
  window.print()
  printMode.value = ''
}

// 演示二维码矩阵缓存：同一码值只计算一次
const qrCache = new Map()

/**
 * FNV-1a 哈希，把码值转成 32 位无符号种子。
 * @param {string} text 码值
 * @returns {number} 哈希值
 */
function hashText(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 1
}

/**
 * 画一个 7×7 定位角（含 1 格静区），并强制覆盖随机点阵。
 * @param {Array<Array<boolean>>} cells 点阵
 * @param {number} rowStart 起始行
 * @param {number} colStart 起始列
 */
function drawFinder(cells, rowStart, colStart) {
  for (let row = -1; row <= 7; row += 1) {
    for (let col = -1; col <= 7; col += 1) {
      const rowIndex = rowStart + row
      const colIndex = colStart + col
      if (rowIndex < 0 || colIndex < 0 || rowIndex >= QR_SIZE || colIndex >= QR_SIZE) {
        continue
      }
      const inFinder = row >= 0 && row <= 6 && col >= 0 && col <= 6
      const dark =
        inFinder &&
        (row === 0 ||
          row === 6 ||
          col === 0 ||
          col === 6 ||
          (row >= 2 && row <= 4 && col >= 2 && col <= 4))
      cells[rowIndex][colIndex] = dark
    }
  }
}

/**
 * 把码值映射成确定性的 25×25 点阵，返回需要绘制的黑色方块坐标。
 * 纯 SVG 演示用，不是真实可扫二维码，样式上与二维码一致。
 * @param {string} code 溯源码
 * @returns {Array<{x:number,y:number}>} 黑色方块坐标
 */
function qrCells(code) {
  const key = String(code || '')
  const cached = qrCache.get(key)
  if (cached) {
    return cached
  }
  const cells = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false))
  let seed = hashText(key)
  const nextSeed = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed
  }
  for (let row = 0; row < QR_SIZE; row += 1) {
    for (let col = 0; col < QR_SIZE; col += 1) {
      cells[row][col] = nextSeed() % 100 < 48
    }
  }
  drawFinder(cells, 0, 0)
  drawFinder(cells, 0, QR_SIZE - 7)
  drawFinder(cells, QR_SIZE - 7, 0)
  // 时序图案：第 6 行 / 第 6 列黑白相间，增强二维码观感
  for (let index = 8; index < QR_SIZE - 8; index += 1) {
    cells[6][index] = index % 2 === 0
    cells[index][6] = index % 2 === 0
  }
  const rects = []
  cells.forEach((line, row) => {
    line.forEach((dark, col) => {
      if (dark) {
        rects.push({ x: col, y: row })
      }
    })
  })
  qrCache.set(key, rects)
  return rects
}

onMounted(loadAll)
</script>

<template>
  <div class="page-container trace-batch">
    <AgriPageHeader
      page-id="P021"
      title="溯源批次与二维码生成"
      description="维护溯源批次并生成一物一码二维码，供消费者扫码查询。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button :disabled="!selectedRow || !panelCodes.length" @click="printGrid">
          打印批次二维码
        </el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="trace-batch__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
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
    <p class="trace-batch__note text-secondary">
      说明：A16 只返回单码累计扫码次数，暂无按月统计口径，「本月扫码次数」为固定演示值； 赋码状态按
      5 kg/件 估算应赋码量，A15 / A16 暂无该字段。
    </p>

    <div class="agri-card trace-batch__section">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card trace-batch__section">
      <div class="trace-batch__toolbar">
        <h3 class="trace-batch__title">溯源批次</h3>
        <span class="text-secondary">共 {{ filteredRows.length }} 个批次</span>
      </div>
      <div v-if="loadError" class="trace-batch__error" @click="loadAll">加载失败，点击重试</div>
      <AgriTable
        v-else
        :columns="columns"
        :data="pagedRows"
        :loading="loading"
        :total="filteredRows.length"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @row-click="selectBatch"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #quantityKg="{ row }">{{ Number(row.quantityKg).toFixed(1) }}</template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="INSPECT_STATUS_MAP" />
        </template>
        <template #codeCount="{ row }">{{ row.codeCount }}</template>
        <template #traceState="{ row }">
          <AgriStatusTag :status="row.traceState" :map="TRACE_STATE_MAP" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" @click.stop="selectBatch(row)">生成二维码</el-button>
          <el-button link type="primary" @click.stop="openPreview(row)">预览</el-button>
          <el-button link type="primary" @click.stop="selectBatch(row)">查看码列表</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 二维码面板：选中批次后展示生成入口、演示二维码与码列表 -->
    <div
      v-if="selectedRow"
      ref="panelRef"
      class="agri-card trace-batch__section trace-batch__panel"
    >
      <div class="trace-batch__panel-head">
        <div>
          <h3 class="trace-batch__title">二维码面板 · {{ selectedRow.batchNo }}</h3>
          <p class="trace-batch__panel-meta text-secondary">
            {{ selectedRow.plotName }} ｜ {{ selectedRow.crop }} ｜ 采收
            {{ selectedRow.harvestDate }} ｜ 已生成 {{ selectedRow.codeCount }} 个 / 估算应赋码
            {{ selectedRow.plannedCount }} 个
          </p>
        </div>
        <div class="trace-batch__panel-actions">
          <el-button :disabled="!panelCodes.length" @click="printGrid">
            打印批次二维码（前 12 个）
          </el-button>
          <el-button
            type="primary"
            :loading="panelLoading"
            @click="loadPanelCodes(selectedRow.batchNo)"
          >
            刷新码列表
          </el-button>
        </div>
      </div>

      <div class="trace-batch__panel-body">
        <div class="trace-batch__qr-box">
          <div v-if="panelCodes.length" v-loading="panelLoading" class="trace-batch__qr-wrap">
            <svg
              class="trace-batch__qr"
              viewBox="-1 -1 27 27"
              role="img"
              :aria-label="`溯源码 ${firstPanelCode} 的演示二维码`"
            >
              <rect x="-1" y="-1" width="27" height="27" fill="#ffffff" />
              <rect
                v-for="cell in qrCells(firstPanelCode)"
                :key="`${cell.x}-${cell.y}`"
                :x="cell.x"
                :y="cell.y"
                width="1"
                height="1"
                fill="#1f2d3d"
              />
            </svg>
            <p class="trace-batch__qr-code">{{ firstPanelCode }}</p>
          </div>
          <AgriEmpty v-else description="该批次尚未生成溯源码" :height="200">
            <el-button type="primary" :loading="genLoading" @click="handleGenerate">
              生成 20 个溯源码
            </el-button>
          </AgriEmpty>
          <div class="trace-batch__qr-actions">
            <el-button :disabled="!panelCodes.length" @click="printPanel">打印本码</el-button>
            <el-button :disabled="!firstPanelCode" @click="copyCode(firstPanelCode)">
              复制码值
            </el-button>
          </div>
        </div>

        <div class="trace-batch__gen">
          <h4 class="trace-batch__sub-title">生成溯源码</h4>
          <el-form label-width="64px" class="trace-batch__gen-form">
            <el-form-item label="前缀">
              <el-input model-value="TRACE-" disabled />
            </el-form-item>
            <el-form-item label="数量">
              <el-input-number v-model="genCount" :min="1" :max="MAX_GENERATE" :step="10" />
              <span class="trace-batch__hint">单次 1~100 个，默认 20</span>
            </el-form-item>
          </el-form>
          <el-button type="primary" :loading="genLoading" @click="handleGenerate">
            生成溯源码
          </el-button>
          <p class="trace-batch__hint trace-batch__hint--block">
            A16 实际编码格式为 TRC-2026-XXXXXX，「前缀」栏按产品约定固定展示
            TRACE-，不参与请求参数。
          </p>
        </div>
      </div>

      <div class="trace-batch__codes">
        <div class="trace-batch__toolbar">
          <h4 class="trace-batch__sub-title">已生成的溯源码（{{ panelCodes.length }} 个）</h4>
          <span class="text-secondary">A16 未提供标记打印接口，打印状态只读</span>
        </div>
        <AgriTable
          :columns="codeColumns"
          :data="panelPagedCodes"
          :loading="panelLoading"
          :total="panelCodes.length"
          :page="panelPage"
          :size="panelSize"
          :page-sizes="[20, 50, 100]"
          row-key="id"
          empty-text="该批次尚未生成溯源码"
          @page-change="handlePanelPageChange"
          @size-change="handlePanelPageChange"
        >
          <template #code="{ row }">
            <span class="trace-batch__code-text">{{ row.code }}</span>
          </template>
          <template #printed="{ row }">
            <AgriStatusTag :status="row.printed ? 'PRINTED' : 'UNPRINTED'" :map="PRINTED_MAP" />
          </template>
          <template #codeAction="{ row }">
            <el-button link type="primary" @click="copyCode(row.code)">复制</el-button>
          </template>
        </AgriTable>
      </div>
    </div>

    <!-- 扫码预览：演示消费者扫码后看到的码值信息 -->
    <el-dialog v-model="previewVisible" title="扫码预览" width="420px">
      <div v-loading="previewLoading" class="trace-batch__preview">
        <template v-if="previewCode">
          <div class="trace-batch__preview-qr">
            <svg
              class="trace-batch__qr"
              viewBox="-1 -1 27 27"
              role="img"
              :aria-label="`溯源码 ${previewCode} 的演示二维码`"
            >
              <rect x="-1" y="-1" width="27" height="27" fill="#ffffff" />
              <rect
                v-for="cell in qrCells(previewCode)"
                :key="`${cell.x}-${cell.y}`"
                :x="cell.x"
                :y="cell.y"
                width="1"
                height="1"
                fill="#1f2d3d"
              />
            </svg>
          </div>
          <p class="trace-batch__preview-code">{{ previewCode }}</p>
          <p class="trace-batch__preview-meta text-secondary">
            批次 {{ previewBatchNo }} ｜ 消费者扫码后进入公开溯源页，可查看产地、农事与检测信息。
          </p>
        </template>
        <AgriEmpty v-else description="该批次尚未生成溯源码，无法预览" :height="160" />
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!previewCode" @click="copyCode(previewCode)">
          复制码值
        </el-button>
      </template>
    </el-dialog>

    <!-- 打印区：仅在 window.print() 期间挂载，@media print 下只显示该区域 -->
    <div v-if="printMode === 'panel' && selectedRow" class="trace-print">
      <h2 class="trace-print__title">{{ selectedRow.batchNo }} 溯源码</h2>
      <p class="trace-print__meta">
        {{ selectedRow.plotName }} ｜ {{ selectedRow.crop }} ｜ 采收 {{ selectedRow.harvestDate }}
      </p>
      <div class="trace-print__single">
        <svg class="trace-print__qr" viewBox="-1 -1 27 27">
          <rect x="-1" y="-1" width="27" height="27" fill="#ffffff" />
          <rect
            v-for="cell in qrCells(firstPanelCode)"
            :key="`${cell.x}-${cell.y}`"
            :x="cell.x"
            :y="cell.y"
            width="1"
            height="1"
            fill="#000000"
          />
        </svg>
        <p class="trace-print__code">{{ firstPanelCode }}</p>
        <p class="trace-print__tip">微信扫一扫，查询产地与检测信息</p>
      </div>
    </div>

    <div v-if="printMode === 'grid' && selectedRow" class="trace-print">
      <h2 class="trace-print__title">
        {{ selectedRow.batchNo }} 溯源码（前 {{ printGridCodes.length }} 个）
      </h2>
      <p class="trace-print__meta">
        {{ selectedRow.plotName }} ｜ {{ selectedRow.crop }} ｜ 采收 {{ selectedRow.harvestDate }}
      </p>
      <div class="trace-print__grid">
        <div v-for="code in printGridCodes" :key="code.id" class="trace-print__cell">
          <svg class="trace-print__qr" viewBox="-1 -1 27 27">
            <rect x="-1" y="-1" width="27" height="27" fill="#ffffff" />
            <rect
              v-for="cell in qrCells(code.code)"
              :key="`${cell.x}-${cell.y}`"
              :x="cell.x"
              :y="cell.y"
              width="1"
              height="1"
              fill="#000000"
            />
          </svg>
          <span class="trace-print__code">{{ code.code }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.trace-batch__stats {
  margin-bottom: $space-sm;
}

.trace-batch__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.trace-batch__note {
  margin: 0 0 $space-md;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.trace-batch__section {
  margin-bottom: $space-md;
}

.trace-batch__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $space-sm;
}

.trace-batch__title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.trace-batch__sub-title {
  margin: 0;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.trace-batch__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

.trace-batch__panel {
  scroll-margin-top: $space-md;
}

.trace-batch__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-md;
  margin-bottom: $space-md;
}

.trace-batch__panel-meta {
  margin: $space-xs 0 0;
  font-size: $font-size-xs;
}

.trace-batch__panel-actions {
  display: flex;
  flex: none;
  gap: $space-sm;
}

.trace-batch__panel-body {
  display: flex;
  gap: $space-lg;
  margin-bottom: $space-md;
  padding-bottom: $space-md;
  border-bottom: 1px dashed $border-color;
}

.trace-batch__qr-box {
  flex: none;
  width: 264px;
  text-align: center;
}

.trace-batch__qr-wrap {
  padding: $space-sm;
  background: #fff;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.trace-batch__qr {
  display: block;
  width: 100%;
  height: auto;
}

.trace-batch__qr-code {
  margin: $space-sm 0 0;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: $font-size-sm;
  letter-spacing: 0.5px;
  color: $text-primary;
}

.trace-batch__qr-actions {
  display: flex;
  justify-content: center;
  gap: $space-sm;
  margin-top: $space-sm;
}

.trace-batch__gen {
  flex: 1;
  min-width: 0;
}

.trace-batch__gen-form {
  max-width: 360px;
  margin-top: $space-sm;
}

.trace-batch__hint {
  margin-left: $space-sm;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.trace-batch__hint--block {
  display: block;
  margin: $space-sm 0 0;
  line-height: 1.6;
}

.trace-batch__codes {
  margin-top: $space-sm;
}

.trace-batch__code-text {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: $font-size-sm;
  color: $text-primary;
}

.trace-batch__preview {
  text-align: center;
}

.trace-batch__preview-qr {
  width: 220px;
  margin: 0 auto;
  padding: $space-sm;
  background: #fff;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.trace-batch__preview-code {
  margin: $space-sm 0 0;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: $font-size-base;
  letter-spacing: 0.5px;
  color: $text-primary;
}

.trace-batch__preview-meta {
  margin: $space-xs 0 0;
  font-size: $font-size-xs;
  line-height: 1.6;
}

// 打印区只在 @media print 下显示，屏幕上始终隐藏
.trace-print {
  display: none;
}

@media (max-width: 1200px) {
  .trace-batch__panel-body {
    flex-direction: column;
  }

  .trace-batch__qr-box {
    width: 240px;
    margin: 0 auto;
  }
}
</style>

<style lang="scss">
// 打印样式：隐藏页面其余内容，只保留 window.print() 期间挂载的 .trace-print 打印区
@media print {
  body * {
    visibility: hidden !important;
  }

  .trace-print,
  .trace-print * {
    visibility: visible !important;
  }

  .trace-print {
    position: absolute;
    top: 0;
    left: 0;
    display: block !important;
    width: 100%;
    padding: 0;
    background: #fff;
    color: #000;
  }

  .trace-print__title {
    margin: 0 0 4mm;
    font-size: 16pt;
    text-align: center;
  }

  .trace-print__meta {
    margin: 0 0 8mm;
    font-size: 10pt;
    text-align: center;
  }

  .trace-print__single {
    text-align: center;
  }

  .trace-print__single .trace-print__qr {
    width: 70mm;
    height: 70mm;
    margin: 0 auto;
  }

  .trace-print__grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10mm 6mm;
  }

  .trace-print__cell {
    text-align: center;
    break-inside: avoid;
  }

  .trace-print__cell .trace-print__qr {
    width: 42mm;
    height: 42mm;
    margin: 0 auto;
  }

  .trace-print__code {
    display: block;
    margin-top: 2mm;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 9pt;
  }

  .trace-print__tip {
    margin-top: 3mm;
    font-size: 9pt;
  }

  @page {
    size: A4;
    margin: 12mm;
  }
}
</style>
