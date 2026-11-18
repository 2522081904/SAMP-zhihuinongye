<script setup>
/**
 * P022 溯源信息编辑与扫码预览
 * 数据来源：A15 采收批次（GET /harvest/batches）、A10 地块（GET /gis/plots）、
 *           A11 农事计划（GET /farm/plans）、A12 农事打卡（GET /farm/records）、
 *           A14 投入品台账（GET /supply/pesticide-logs）、
 *           A16 溯源码（GET /trace/batches/{batchNo}/codes）、A18 检测报告（GET /trace/inspections）。
 * 数据缺口与限制：
 * - A16 / A17 没有「溯源展示内容」的读写接口，编辑结果只落浏览器 localStorage
 *   （key: agri-trace-profile-v1，结构 { [batchNo]: { title, intro, sellingPoints,
 *   showInspection, showFarmLog, savedAt } }），换浏览器或清缓存即丢失；
 *   接入后端后把 handleSave 里的本地写入替换为保存接口即可，页面其余逻辑不变；
 * - A12 打卡记录 mock 初始为空（runtime.farmRecords = []），农事时间线主要由 A11 计划构成；
 * - A10 没有独立的 lng / lat 字段，经纬度取地块 boundary 首点（center）展示，不是几何质心；
 * - A18 只返回整份报告的结论，预览只展示最近一份报告的结论徽标。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，保存时间戳取该常量，
 *           禁止用 Date.now() 参与业务判断，仅允许用于格式化。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import {
  fetchBatchTraceCodes,
  fetchFarmPlans,
  fetchFarmRecords,
  fetchHarvestBatches,
  fetchInspections,
  fetchPesticideLogs,
  fetchPlots
} from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'

defineOptions({ name: 'TraceEditPage' })

// 展示信息本地存储 key（无后端接口，见文件头说明）
const PROFILE_STORAGE_KEY = 'agri-trace-profile-v1'
// 业务「现在」：mock 固定时间，仅用于保存时间戳
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
// 消费者扫码页地址（M003）
const SCAN_PAGE_URL = 'https://2522081904.github.io/SAMP-zhihuinongye/#/trace/scan'

// 展示字段限制
const MAX_TITLE_LENGTH = 30
const MAX_INTRO_LENGTH = 200
const MAX_SELLING_POINTS = 6
const MAX_POINT_LENGTH = 8

// 列表与摘要条数限制
const BATCH_PAGE_SIZE = 40
const MAX_TIMELINE_ITEMS = 6
const PREVIEW_TIMELINE_ITEMS = 4
const MAX_INPUT_ROWS = 5
const PREVIEW_INPUT_ROWS = 3

// 批次检测状态：AgriStatusTag 内置的 PENDING 是「待处置」，必须传业务态 map
const BATCH_STATUS_MAP = {
  PENDING: { text: '待检', type: 'info' },
  INSPECTING: { text: '检测中', type: 'primary' },
  QUALIFIED: { text: '合格', type: 'success' },
  REJECTED: { text: '不合格', type: 'danger' }
}

// 检测报告结论
const INSPECTION_STATUS_MAP = {
  PASS: { text: '合格', type: 'success' },
  FAIL: { text: '不合格', type: 'danger' }
}

// 编辑区四段折叠面板，默认全部展开
const activeSections = ref(['origin', 'farm', 'input', 'inspect'])

const batches = ref([])
const plots = ref([])
const loading = ref(false)
const loadError = ref(false)
const keyword = ref('')

const selectedBatchNo = ref('')
const detailLoading = ref(false)
const plans = ref([])
const records = ref([])
const logs = ref([])
const inspections = ref([])
const batchCodes = ref([])

// 本地已保存的展示信息：{ [batchNo]: {...} }
const profileMap = ref(readProfiles())

// 当前编辑表单
const form = reactive({
  title: '',
  intro: '',
  sellingPoints: [],
  showInspection: true,
  showFarmLog: true
})
const pointInput = ref('')
// 表单基线（用于判断「有未保存改动」）
const baseline = ref('')

/**
 * 读取本地展示信息存档。
 * 存储内容可能被手工改坏，解析失败一律按空对象处理，不阻断页面。
 * @returns {Object} 批次号 → 展示信息
 */
function readProfiles() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch {
    // 非法 JSON 或隐私模式禁用存储时降级为无存档
    return {}
  }
}

/**
 * 写入本地展示信息存档。
 * @param {Object} profiles 批次号 → 展示信息
 * @returns {boolean} 是否写入成功
 */
function writeProfiles(profiles) {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles))
    return true
  } catch {
    return false
  }
}

const selectedBatch = computed(
  () => batches.value.find((batch) => batch.batchNo === selectedBatchNo.value) || null
)

/**
 * 按批次 plotId 匹配 A10 地块。
 * @param {Object|null} batch 采收批次
 * @returns {Object|null} 地块
 */
function plotOf(batch) {
  if (!batch) {
    return null
  }
  return plots.value.find((plot) => plot.id === batch.plotId) || null
}

const plot = computed(() => plotOf(selectedBatch.value))

// 经纬度：A10 无独立字段，取 boundary 首点 center 展示
const plotCenterText = computed(() => {
  const center = plot.value?.center
  if (!Array.isArray(center) || center.length < 2) {
    return '-'
  }
  return `${Number(center[0]).toFixed(6)}, ${Number(center[1]).toFixed(6)}`
})

const filteredBatches = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (!word) {
    return batches.value
  }
  return batches.value.filter((batch) =>
    [batch.batchNo, batch.crop, batch.variety, batch.plotName].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(word)
    )
  )
})

/**
 * 单个批次的默认展示文案（同时也是「重置」的目标值）。
 * @param {Object} batch 采收批次
 * @returns {Object} 默认展示信息
 */
function defaultProfile(batch) {
  const targetPlot = plotOf(batch)
  const origin = targetPlot?.name || batch.plotName || '本基地'
  const variety = batch.variety ? `（${batch.variety}）` : ''
  return {
    title: `${batch.crop}${variety} · ${origin}直供`,
    intro: `本批次${batch.crop}产自${origin}，${batch.harvestDate} 完成采收，采后及时预冷，全程可追溯。`,
    sellingPoints: ['产地直供', '绿色防控', '冷链预检'],
    showInspection: true,
    showFarmLog: true
  }
}

/**
 * 把展示信息写进表单（数组做拷贝，避免与存档对象共享引用）。
 * @param {Object} profile 展示信息
 */
function applyProfile(profile) {
  form.title = String(profile.title || '')
  form.intro = String(profile.intro || '')
  form.sellingPoints = Array.isArray(profile.sellingPoints)
    ? profile.sellingPoints
        .slice(0, MAX_SELLING_POINTS)
        .map((point) => String(point).slice(0, MAX_POINT_LENGTH))
    : []
  form.showInspection = profile.showInspection !== false
  form.showFarmLog = profile.showFarmLog !== false
  pointInput.value = ''
}

/** 表单快照：用于判断是否有未保存改动 */
function snapshotForm() {
  return JSON.stringify({
    title: form.title,
    intro: form.intro,
    sellingPoints: [...form.sellingPoints],
    showInspection: form.showInspection,
    showFarmLog: form.showFarmLog
  })
}

const isDirty = computed(
  () => Boolean(selectedBatchNo.value) && baseline.value !== '' && snapshotForm() !== baseline.value
)

// 农事时间线：A11 计划 + A12 打卡，按时间倒序
const timelineItems = computed(() => {
  const batch = selectedBatch.value
  if (!batch) {
    return []
  }
  const items = []
  plans.value.forEach((plan) => {
    const time = `${plan.planDate} ${plan.startTime || '08:00'}`
    items.push({
      key: `plan-${plan.id}`,
      time,
      sortAt: time,
      title: plan.title,
      desc: `${plan.statusName} · 负责人 ${plan.owner}`,
      // 已完成 / 进行中的农事才对外展示，草稿与已取消计划只在编辑区可见
      executed: ['DONE', 'DOING'].includes(plan.status)
    })
  })
  records.value.forEach((record) => {
    items.push({
      key: `record-${record.id}`,
      time: record.checkedAt,
      sortAt: String(record.checkedAt || ''),
      title: '农事打卡',
      desc: `${record.content || '现场打卡'}（${record.operator || '-'}）`,
      executed: true
    })
  })
  return items.sort((left, right) => right.sortAt.localeCompare(left.sortAt))
})

// 编辑区展示全部农事（含草稿/已取消），扫码预览只展示已执行的农事
const editorTimeline = computed(() => timelineItems.value.slice(0, MAX_TIMELINE_ITEMS))
const previewTimeline = computed(() =>
  timelineItems.value.filter((item) => item.executed).slice(0, PREVIEW_TIMELINE_ITEMS)
)
const editorLogs = computed(() => logs.value.slice(0, MAX_INPUT_ROWS))
const previewLogs = computed(() => logs.value.slice(0, PREVIEW_INPUT_ROWS))
const latestInspection = computed(() => inspections.value[0] || null)

// 预览：最近一份检测报告的结论徽标
const inspectionBadge = computed(() => {
  const report = latestInspection.value
  if (!report) {
    return { text: '待检测', tone: 'pending' }
  }
  return report.conclusion === 'PASS'
    ? { text: '检测合格', tone: 'pass' }
    : { text: '检测不合格', tone: 'fail' }
})

// 预览：第一个溯源码（无码时按钮给引导）
const primaryCode = computed(() => batchCodes.value[0]?.code || '')
const previewUrl = computed(() => (primaryCode.value ? scanUrlOf(primaryCode.value) : ''))

/**
 * 拼接消费者扫码页链接。
 * @param {string} code 溯源码
 * @returns {string} 扫码页地址
 */
function scanUrlOf(code) {
  return `${SCAN_PAGE_URL}?code=${encodeURIComponent(code)}`
}

/**
 * 载入批次列表与地块档案。
 * 首次进入不自动选批次，便于展示右侧「请从左侧选择一个批次」的空态。
 * @returns {Promise<void>}
 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [batchData, plotData] = await Promise.all([
      fetchHarvestBatches({ page: 1, size: BATCH_PAGE_SIZE }),
      fetchPlots({ page: 1, size: 100 })
    ])
    batches.value = batchData?.list || []
    plots.value = plotData?.list || []
    const current = batches.value.find((batch) => batch.batchNo === selectedBatchNo.value)
    if (current) {
      await loadBatchDetail(current)
    }
  } catch (err) {
    loadError.value = true
    if (err?.code === 40401) {
      loadError.value = false
    }
  } finally {
    loading.value = false
  }
}

/**
 * 拉取当前批次的农事、投入品、检测与溯源码数据，并应用已保存的展示信息。
 * @param {Object} batch 采收批次
 * @returns {Promise<void>}
 */
async function loadBatchDetail(batch) {
  if (!batch) {
    return
  }
  detailLoading.value = true
  plans.value = []
  records.value = []
  logs.value = []
  inspections.value = []
  batchCodes.value = []
  try {
    const [planData, recordData, logData, inspectionData, codeData] = await Promise.all([
      fetchFarmPlans({ plotId: batch.plotId, page: 1, size: 100 }),
      fetchFarmRecords({ plotId: batch.plotId, page: 1, size: 100 }),
      fetchPesticideLogs({ plotId: batch.plotId, page: 1, size: 100 }),
      fetchInspections({ batchNo: batch.batchNo, page: 1, size: 20 }),
      fetchBatchTraceCodes(batch.batchNo)
    ])
    plans.value = planData?.list || []
    records.value = recordData?.list || []
    logs.value = logData?.list || []
    inspections.value = inspectionData?.list || []
    batchCodes.value = codeData?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error('批次溯源数据加载失败，请稍后重试')
    }
  } finally {
    const saved = profileMap.value[batch.batchNo]
    applyProfile({ ...defaultProfile(batch), ...(saved || {}) })
    baseline.value = snapshotForm()
    detailLoading.value = false
  }
}

/**
 * 选择批次：有未保存改动时先确认，再加载该批次的溯源数据。
 * @param {Object} batch 批次
 * @returns {Promise<void>}
 */
async function selectBatch(batch) {
  if (!batch || batch.batchNo === selectedBatchNo.value) {
    return
  }
  if (isDirty.value) {
    try {
      await ElMessageBox.confirm(
        '当前批次的展示信息还有未保存的改动，切换批次后这些改动会丢失。',
        '有未保存的改动',
        {
          confirmButtonText: '放弃改动并切换',
          cancelButtonText: '留在此批次',
          type: 'warning'
        }
      )
    } catch {
      return
    }
  }
  selectedBatchNo.value = batch.batchNo
  await loadBatchDetail(batch)
}

/** 新增卖点标签：回车触发，最多 6 个、每个 ≤ 8 字 */
function addPoint() {
  const value = pointInput.value.trim()
  if (!value) {
    return
  }
  if (value.length > MAX_POINT_LENGTH) {
    ElMessage.warning(`单个卖点标签不超过 ${MAX_POINT_LENGTH} 个字`)
    return
  }
  if (form.sellingPoints.includes(value)) {
    ElMessage.warning('该卖点标签已存在')
    pointInput.value = ''
    return
  }
  if (form.sellingPoints.length >= MAX_SELLING_POINTS) {
    ElMessage.warning(`最多添加 ${MAX_SELLING_POINTS} 个卖点标签`)
    return
  }
  form.sellingPoints.push(value)
  pointInput.value = ''
}

/**
 * 删除卖点标签。
 * @param {number} index 下标
 */
function removePoint(index) {
  form.sellingPoints.splice(index, 1)
}

/**
 * 保存展示信息：A16/A17 无保存接口，写入 localStorage（key 见文件头说明）。
 */
function handleSave() {
  const batch = selectedBatch.value
  if (!batch) {
    return
  }
  const title = form.title.trim()
  if (!title) {
    ElMessage.warning('请填写溯源展示标题')
    return
  }
  if (title.length > MAX_TITLE_LENGTH) {
    ElMessage.warning(`溯源展示标题不超过 ${MAX_TITLE_LENGTH} 个字`)
    return
  }
  const intro = form.intro.trim()
  if (intro.length > MAX_INTRO_LENGTH) {
    ElMessage.warning(`产品简介不超过 ${MAX_INTRO_LENGTH} 个字`)
    return
  }
  form.title = title
  form.intro = intro
  const profiles = { ...readProfiles() }
  profiles[batch.batchNo] = {
    title,
    intro,
    sellingPoints: [...form.sellingPoints].slice(0, MAX_SELLING_POINTS),
    showInspection: form.showInspection,
    showFarmLog: form.showFarmLog,
    savedAt: BUSINESS_NOW_TEXT
  }
  if (!writeProfiles(profiles)) {
    ElMessage.error('本地存储不可用，展示信息保存失败')
    return
  }
  profileMap.value = profiles
  baseline.value = snapshotForm()
  ElMessage.success('溯源展示信息已保存')
}

/**
 * 重置：清除该批次存档并恢复默认文案（需再次保存才会重新落盘）。
 */
function handleReset() {
  const batch = selectedBatch.value
  if (!batch) {
    return
  }
  const profiles = { ...readProfiles() }
  delete profiles[batch.batchNo]
  writeProfiles(profiles)
  profileMap.value = profiles
  applyProfile(defaultProfile(batch))
  baseline.value = snapshotForm()
  ElMessage.success('已恢复默认展示文案')
}

/**
 * 复制文本：优先 Clipboard API，非安全上下文降级为 textarea + execCommand。
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
    // 权限或非安全上下文中可能抛错，继续走降级方案
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
 * 生成预览链接：拼接 M003 扫码页地址并复制到剪贴板。
 * @returns {Promise<void>}
 */
async function handleGenerateLink() {
  if (!primaryCode.value) {
    ElMessage.warning('该批次还没有溯源码，请先在 P021 生成')
    return
  }
  const copied = await copyText(previewUrl.value)
  if (copied) {
    ElMessage.success('预览链接已复制，可直接在浏览器打开')
  } else {
    ElMessage.error('复制失败，请手动复制预览链接')
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="page-container trace-edit">
    <AgriPageHeader
      page-id="P022"
      title="溯源信息编辑与扫码预览"
      description="编辑批次溯源展示内容，并实时预览消费者扫码看到的页面。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" :disabled="!selectedBatch" @click="handleGenerateLink">
          生成预览链接
        </el-button>
      </template>
    </AgriPageHeader>

    <div v-if="loadError" class="trace-edit__error" @click="loadAll">加载失败，点击重试</div>

    <div v-else class="trace-edit__layout">
      <!-- 左栏：批次选择 -->
      <aside class="agri-card trace-edit__list">
        <div class="trace-edit__panel-head">
          <h3 class="trace-edit__panel-title">选择批次</h3>
          <span class="text-secondary">{{ filteredBatches.length }} / {{ batches.length }} 个</span>
        </div>
        <el-input
          v-model="keyword"
          class="trace-edit__search"
          placeholder="搜索批次号 / 作物 / 地块"
          clearable
        />
        <div v-loading="loading" class="trace-edit__batch-list">
          <button
            v-for="batch in filteredBatches"
            :key="batch.id"
            type="button"
            class="trace-edit__batch"
            :class="{ 'is-active': batch.batchNo === selectedBatchNo }"
            @click="selectBatch(batch)"
          >
            <span class="trace-edit__batch-no">{{ batch.batchNo }}</span>
            <span class="trace-edit__batch-meta">
              {{ batch.crop }} · {{ batch.plotName }} · {{ batch.harvestDate }}
            </span>
            <span class="trace-edit__batch-tags">
              <AgriStatusTag :status="batch.status" :map="BATCH_STATUS_MAP" />
              <el-tag v-if="profileMap[batch.batchNo]" size="small" type="success" effect="plain">
                已配置
              </el-tag>
            </span>
          </button>
          <AgriEmpty
            v-if="!loading && !filteredBatches.length"
            description="暂无匹配批次，请先在 P020 登记采收批次"
            height="180px"
          />
        </div>
      </aside>

      <!-- 中栏：编辑区 -->
      <section class="trace-edit__editor">
        <template v-if="selectedBatch">
          <div v-loading="detailLoading" class="agri-card trace-edit__card">
            <div class="trace-edit__batch-head">
              <div>
                <h3 class="trace-edit__panel-title">{{ selectedBatch.batchNo }}</h3>
                <p class="trace-edit__batch-desc">
                  {{ selectedBatch.crop }} · {{ selectedBatch.variety || '当季品种' }} ·
                  {{ selectedBatch.plotName }} · 采收 {{ selectedBatch.harvestDate }} · 溯源码
                  {{ batchCodes.length }} 个
                </p>
              </div>
              <AgriStatusTag :status="selectedBatch.status" :map="BATCH_STATUS_MAP" />
            </div>

            <el-collapse v-model="activeSections">
              <el-collapse-item name="origin">
                <template #title>
                  <span class="trace-edit__collapse-title">产地信息</span>
                </template>
                <el-descriptions :column="1" size="small" border>
                  <el-descriptions-item label="产地名称">
                    {{ plot?.name || selectedBatch.plotName || '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="产地地址">
                    {{ plot?.address || '-' }}
                  </el-descriptions-item>
                  <el-descriptions-item label="经纬度">
                    {{ plotCenterText }}
                  </el-descriptions-item>
                  <el-descriptions-item label="地块信息">
                    {{ plot?.areaMu ?? '-' }} 亩 · 负责人 {{ plot?.manager || '-' }} ·
                    {{ plot?.irrigation || '-' }}
                  </el-descriptions-item>
                </el-descriptions>
                <p class="trace-edit__hint">
                  A10 地块档案按批次 plotId 匹配，本段只读；经纬度取地块 boundary 首点（center）。
                </p>
              </el-collapse-item>

              <el-collapse-item name="farm">
                <template #title>
                  <span class="trace-edit__collapse-title">
                    农事记录
                    <em class="trace-edit__count">共 {{ timelineItems.length }} 条</em>
                  </span>
                </template>
                <AgriEmpty
                  v-if="!timelineItems.length"
                  description="该地块暂无农事计划与打卡记录"
                  height="140px"
                />
                <template v-else>
                  <el-timeline class="trace-edit__timeline">
                    <el-timeline-item
                      v-for="item in editorTimeline"
                      :key="item.key"
                      :timestamp="item.time"
                      placement="top"
                      type="primary"
                    >
                      <p class="trace-edit__timeline-title">{{ item.title }}</p>
                      <p class="trace-edit__timeline-desc">{{ item.desc }}</p>
                    </el-timeline-item>
                  </el-timeline>
                  <p class="trace-edit__hint">
                    A11 农事计划 + A12 打卡记录按 plotId 过滤，按时间倒序展示最近
                    {{ MAX_TIMELINE_ITEMS }} 条（当前 A12 打卡
                    {{ records.length }} 条）；扫码预览只展示已完成 /
                    进行中的农事，草稿与已取消计划不对外展示。
                  </p>
                </template>
              </el-collapse-item>

              <el-collapse-item name="input">
                <template #title>
                  <span class="trace-edit__collapse-title">
                    投入品使用
                    <em class="trace-edit__count">共 {{ logs.length }} 条</em>
                  </span>
                </template>
                <AgriEmpty
                  v-if="!logs.length"
                  description="该地块暂无投入品使用记录"
                  height="140px"
                />
                <template v-else>
                  <el-table :data="editorLogs" size="small" border class="trace-edit__table">
                    <el-table-column label="日期" width="94">
                      <template #default="{ row }">{{
                        String(row.appliedAt).slice(0, 10)
                      }}</template>
                    </el-table-column>
                    <el-table-column prop="pesticideName" label="投入品" min-width="126" />
                    <el-table-column label="用量" width="94">
                      <template #default="{ row }">{{ row.dose }} {{ row.unit }}</template>
                    </el-table-column>
                    <el-table-column label="安全间隔期" width="92" align="center">
                      <template #default="{ row }">{{ row.safeIntervalDays }} 天</template>
                    </el-table-column>
                  </el-table>
                  <p class="trace-edit__hint">
                    A14 台账按 plotId 过滤，最多展示 {{ MAX_INPUT_ROWS }} 行（共
                    {{ logs.length }} 条，按施用时间倒序）。
                  </p>
                </template>
              </el-collapse-item>

              <el-collapse-item name="inspect">
                <template #title>
                  <span class="trace-edit__collapse-title">
                    检测报告
                    <em class="trace-edit__count">共 {{ inspections.length }} 份</em>
                  </span>
                </template>
                <AgriEmpty
                  v-if="!inspections.length"
                  description="该批次暂无检测报告"
                  height="140px"
                />
                <template v-else>
                  <el-table :data="inspections" size="small" border class="trace-edit__table">
                    <el-table-column prop="reportNo" label="报告编号" min-width="126" />
                    <el-table-column label="结论" width="84" align="center">
                      <template #default="{ row }">
                        <AgriStatusTag :status="row.conclusion" :map="INSPECTION_STATUS_MAP" />
                      </template>
                    </el-table-column>
                    <el-table-column label="日期" width="150">
                      <template #default="{ row }">
                        {{ String(row.inspectedAt || '').slice(0, 10) }}
                      </template>
                    </el-table-column>
                  </el-table>
                  <p class="trace-edit__hint">A18 按批次号过滤，报告在 P023 登记，本段只读。</p>
                </template>
              </el-collapse-item>
            </el-collapse>
          </div>

          <div class="agri-card trace-edit__card">
            <div class="trace-edit__panel-head">
              <h3 class="trace-edit__panel-title">展示设置</h3>
              <span class="text-secondary">仅影响消费者扫码页，不改变溯源数据</span>
            </div>
            <el-form label-position="top" class="trace-edit__form">
              <el-form-item label="溯源展示标题">
                <el-input
                  v-model="form.title"
                  :maxlength="MAX_TITLE_LENGTH"
                  show-word-limit
                  placeholder="例如：瑞粉 882 番茄 · 一号连栋温室直供"
                />
              </el-form-item>
              <el-form-item label="产品简介">
                <el-input
                  v-model="form.intro"
                  type="textarea"
                  :rows="4"
                  :maxlength="MAX_INTRO_LENGTH"
                  show-word-limit
                  placeholder="介绍产地环境、种植方式与采收标准"
                />
              </el-form-item>
              <el-form-item label="卖点标签">
                <div class="trace-edit__tags">
                  <el-tag
                    v-for="(point, index) in form.sellingPoints"
                    :key="point"
                    class="trace-edit__tag"
                    closable
                    @close="removePoint(index)"
                  >
                    {{ point }}
                  </el-tag>
                  <el-input
                    v-if="form.sellingPoints.length < MAX_SELLING_POINTS"
                    v-model="pointInput"
                    class="trace-edit__tag-input"
                    size="small"
                    :maxlength="MAX_POINT_LENGTH"
                    placeholder="回车新增"
                    @keydown.enter.prevent="addPoint"
                  />
                </div>
                <p class="trace-edit__hint">
                  最多 {{ MAX_SELLING_POINTS }} 个，每个不超过
                  {{ MAX_POINT_LENGTH }} 字；回车新增，点 × 删除。
                </p>
              </el-form-item>
              <el-form-item label="展示检测报告">
                <el-switch v-model="form.showInspection" class="trace-edit__switch" />
                <span class="trace-edit__switch-tip">关闭后扫码页不展示检测结论徽标</span>
              </el-form-item>
              <el-form-item label="展示农事记录">
                <el-switch v-model="form.showFarmLog" class="trace-edit__switch" />
                <span class="trace-edit__switch-tip">关闭后扫码页不展示农事时间线</span>
              </el-form-item>
            </el-form>
            <div class="trace-edit__actions">
              <el-button type="primary" @click="handleSave">保存</el-button>
              <el-button @click="handleReset">重置</el-button>
              <span v-if="isDirty" class="trace-edit__dirty">有未保存的改动</span>
              <span v-else class="trace-edit__hint trace-edit__hint--inline">
                保存后写入浏览器本地（key: agri-trace-profile-v1），无后端保存接口
              </span>
            </div>
          </div>
        </template>

        <div v-else class="agri-card trace-edit__guide">
          <AgriEmpty description="请从左侧选择一个批次" height="320px" />
        </div>
      </section>

      <!-- 右栏：手机预览（固定） -->
      <aside class="trace-edit__preview">
        <div class="trace-edit__panel-head trace-edit__panel-head--preview">
          <h3 class="trace-edit__panel-title">手机预览</h3>
          <span class="text-secondary">M003 · 实时</span>
        </div>

        <div v-if="selectedBatch" class="trace-edit__phone-wrap">
          <div class="trace-edit__phone">
            <span class="trace-edit__notch" />
            <div class="trace-edit__screen">
              <div class="trace-edit__scan-head">
                <p class="trace-edit__scan-company">江苏绿谷现代农业发展有限公司</p>
                <h4 class="trace-edit__scan-title">{{ form.title || '溯源展示标题' }}</h4>
                <p class="trace-edit__scan-badge">扫码溯源 · 一物一码</p>
              </div>

              <div class="trace-edit__scan-card">
                <div class="trace-edit__scan-row">
                  <span>产品</span>
                  <b>{{ selectedBatch.crop }}（{{ selectedBatch.variety || '当季品种' }}）</b>
                </div>
                <div class="trace-edit__scan-row">
                  <span>产地</span>
                  <b>{{ plot?.name || selectedBatch.plotName }}</b>
                </div>
                <div class="trace-edit__scan-row">
                  <span>溯源码</span>
                  <b class="trace-edit__scan-code">{{ primaryCode || '待生成' }}</b>
                </div>
              </div>

              <div v-if="form.sellingPoints.length" class="trace-edit__scan-tags">
                <span v-for="point in form.sellingPoints" :key="point" class="trace-edit__scan-tag">
                  {{ point }}
                </span>
              </div>

              <div v-if="form.showFarmLog" class="trace-edit__scan-block">
                <h5 class="trace-edit__scan-block-title">农事记录</h5>
                <ol v-if="previewTimeline.length" class="trace-edit__scan-timeline">
                  <li v-for="item in previewTimeline" :key="item.key">
                    <span class="trace-edit__scan-time">{{ String(item.time).slice(0, 10) }}</span>
                    <span class="trace-edit__scan-text">{{ item.title }}</span>
                  </li>
                </ol>
                <p v-else class="trace-edit__scan-empty">暂无农事记录</p>
              </div>

              <div class="trace-edit__scan-block">
                <h5 class="trace-edit__scan-block-title">投入品使用</h5>
                <ul v-if="previewLogs.length" class="trace-edit__scan-inputs">
                  <li v-for="log in previewLogs" :key="log.id">
                    <span>{{ String(log.appliedAt).slice(0, 10) }}</span>
                    <span class="trace-edit__scan-text">{{ log.pesticideName }}</span>
                  </li>
                </ul>
                <p v-else class="trace-edit__scan-empty">暂无投入品使用记录</p>
              </div>

              <div v-if="form.showInspection" class="trace-edit__scan-block">
                <h5 class="trace-edit__scan-block-title">检测报告</h5>
                <span
                  class="trace-edit__badge trace-edit__badge--inspect"
                  :class="`trace-edit__badge--${inspectionBadge.tone}`"
                >
                  {{ inspectionBadge.text }}
                </span>
                <p v-if="latestInspection" class="trace-edit__scan-report">
                  {{ latestInspection.reportNo }} ·
                  {{ String(latestInspection.inspectedAt).slice(0, 10) }}
                </p>
                <p v-else class="trace-edit__scan-empty">该批次暂无检测报告</p>
              </div>

              <p class="trace-edit__scan-foot">
                本页数据由生产主体提供，扫码可核验产地、农事与检测信息
              </p>
            </div>
            <div class="trace-edit__home-bar"><span /></div>
          </div>
        </div>

        <div v-else class="agri-card trace-edit__guide trace-edit__guide--preview">
          <AgriEmpty description="请从左侧选择一个批次" height="240px" />
        </div>

        <div v-if="selectedBatch" class="agri-card trace-edit__link">
          <p class="trace-edit__link-label">消费者预览链接</p>
          <p class="trace-edit__link-url">
            {{ previewUrl || '该批次还没有溯源码，请先在 P021 生成' }}
          </p>
          <el-button size="small" :disabled="!primaryCode" @click="handleGenerateLink">
            复制链接
          </el-button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.trace-edit__error {
  padding: $space-xl 0;
  text-align: center;
  font-size: $font-size-sm;
  color: $danger-color;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  background: $bg-page;
  cursor: pointer;
}

// 三栏：批次列表 / 编辑区 / 手机预览；右栏固定 400px 以容纳 375px 手机壳
.trace-edit__layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 400px;
  gap: $space-md;
  align-items: start;
}

.trace-edit__list {
  position: sticky;
  top: $space-md;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 180px);
}

.trace-edit__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.trace-edit__panel-head--preview {
  margin-bottom: $space-sm;
}

.trace-edit__panel-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__search {
  margin-bottom: $space-sm;
}

.trace-edit__batch-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
}

.trace-edit__batch {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: $space-sm $space-sm;
  margin-bottom: $space-xs;
  text-align: left;
  cursor: pointer;
  background: $bg-page;
  border: 1px solid transparent;
  border-radius: $radius-md;
  transition:
    border-color 0.2s,
    background-color 0.2s;

  &:hover {
    border-color: $primary-light;
  }

  &.is-active {
    background: $primary-lighter;
    border-color: $primary-color;
  }
}

.trace-edit__batch-no {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__batch-meta {
  font-size: $font-size-xs;
  line-height: 1.5;
  color: $text-secondary;
}

.trace-edit__batch-tags {
  display: flex;
  align-items: center;
  gap: $space-xs;
  margin-top: 2px;
}

.trace-edit__editor {
  min-width: 0;
}

.trace-edit__card {
  margin-bottom: $space-md;
}

.trace-edit__batch-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-sm;
  padding-bottom: $space-sm;
  margin-bottom: $space-xs;
  border-bottom: 1px dashed $border-color;
}

.trace-edit__batch-desc {
  margin: $space-xs 0 0;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
}

.trace-edit__collapse-title {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__count {
  margin-left: $space-sm;
  font-size: $font-size-xs;
  font-style: normal;
  font-weight: 400;
  color: $text-secondary;
}

.trace-edit__hint {
  margin: $space-sm 0 0;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
}

.trace-edit__hint--inline {
  margin: 0;
}

.trace-edit__timeline {
  padding-left: $space-xs;
  margin-top: $space-sm;
}

.trace-edit__timeline-title {
  margin: 0;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__timeline-desc {
  margin: 2px 0 0;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
}

.trace-edit__table {
  margin-top: $space-sm;
}

.trace-edit__form {
  margin-top: $space-xs;
}

.trace-edit__tags {
  display: flex;
  flex-wrap: wrap;
  gap: $space-sm;
  align-items: center;
}

.trace-edit__tag-input {
  width: 120px;
}

.trace-edit__switch {
  margin-right: $space-sm;
}

.trace-edit__switch-tip {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.trace-edit__actions {
  display: flex;
  align-items: center;
  gap: $space-sm;
  padding-top: $space-sm;
  margin-top: $space-xs;
  border-top: 1px dashed $border-color;
}

.trace-edit__dirty {
  font-size: $font-size-xs;
  color: $warning-color;
}

.trace-edit__guide {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
}

.trace-edit__preview {
  position: sticky;
  top: $space-md;
}

.trace-edit__phone-wrap {
  display: flex;
  justify-content: center;
}

// 手机壳：自绘圆角边框 + 刘海 + 底部安全条
.trace-edit__phone {
  position: relative;
  width: 375px;
  max-width: 100%;
  padding: 10px 10px 6px;
  background: #22303c;
  border-radius: 40px;
  box-shadow: 0 10px 26px rgba(31, 45, 61, 0.24);
}

.trace-edit__notch {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 2;
  width: 112px;
  height: 22px;
  background: #22303c;
  border-radius: 0 0 14px 14px;
  transform: translateX(-50%);
}

.trace-edit__screen {
  height: 548px;
  padding: $space-md $space-md $space-lg;
  overflow-y: auto;
  color: $text-primary;
  background: #f4f7f5;
  border-radius: 30px;

  &::-webkit-scrollbar {
    width: 0;
  }
}

.trace-edit__scan-head {
  padding: 18px $space-md 16px;
  color: #fff;
  background: linear-gradient(150deg, #2e7d58, #4c9f75);
  border-radius: $radius-md;
}

.trace-edit__scan-company {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.4px;
  opacity: 0.86;
}

.trace-edit__scan-title {
  margin: 6px 0 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
}

.trace-edit__scan-badge {
  display: inline-block;
  padding: 2px 8px;
  margin: $space-sm 0 0;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
}

.trace-edit__scan-card {
  padding: $space-sm $space-md;
  margin-top: $space-sm;
  background: #fff;
  border-radius: $radius-md;
  box-shadow: 0 1px 4px rgba(31, 45, 61, 0.06);
}

.trace-edit__scan-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-sm;
  padding: 6px 0;
  font-size: 11px;
  color: $text-secondary;
  border-bottom: 1px dashed $border-color;

  &:last-child {
    border-bottom: none;
  }

  b {
    font-weight: 600;
    color: $text-primary;
    text-align: right;
    word-break: break-all;
  }
}

.trace-edit__scan-code {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 10px;
}

.trace-edit__scan-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: $space-sm;
}

.trace-edit__scan-tag {
  padding: 2px 8px;
  font-size: 10px;
  color: $primary-color;
  background: $primary-lighter;
  border: 1px solid rgba(46, 125, 88, 0.24);
  border-radius: 999px;
}

.trace-edit__scan-block {
  padding: $space-sm $space-md;
  margin-top: $space-sm;
  background: #fff;
  border-radius: $radius-md;
  box-shadow: 0 1px 4px rgba(31, 45, 61, 0.06);
}

.trace-edit__scan-block-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__scan-timeline {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    display: flex;
    gap: $space-sm;
    padding: 4px 0;
    font-size: 11px;
    color: $text-regular;
  }
}

.trace-edit__scan-time {
  flex: none;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 10px;
  color: $text-secondary;
}

.trace-edit__scan-inputs {
  padding: 0;
  margin: 0;
  list-style: none;

  li {
    display: flex;
    justify-content: space-between;
    gap: $space-sm;
    padding: 4px 0;
    font-size: 11px;
    color: $text-secondary;
  }
}

.trace-edit__scan-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: $text-primary;
}

.trace-edit__scan-report {
  margin: 6px 0 0;
  font-size: 10px;
  color: $text-secondary;
}

.trace-edit__scan-empty {
  margin: 0;
  font-size: 10px;
  color: $text-secondary;
}

.trace-edit__badge {
  display: inline-block;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  border-radius: 999px;
}

// 合格=绿色（主色 #2e7d58），不合格=红色，待检测=灰色
.trace-edit__badge--pass {
  background: #2e7d58;
}

.trace-edit__badge--fail {
  background: #d64545;
}

.trace-edit__badge--pending {
  background: $info-color;
}

.trace-edit__scan-foot {
  margin: $space-md 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: $text-secondary;
  text-align: center;
}

.trace-edit__home-bar {
  display: flex;
  justify-content: center;
  padding: 5px 0 1px;

  span {
    width: 120px;
    height: 4px;
    background: #6b7a88;
    border-radius: 2px;
  }
}

.trace-edit__guide--preview {
  min-height: 280px;
}

.trace-edit__link {
  margin-top: $space-md;
}

.trace-edit__link-label {
  margin: 0 0 $space-xs;
  font-size: $font-size-xs;
  font-weight: 600;
  color: $text-primary;
}

.trace-edit__link-url {
  margin: 0 0 $space-sm;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 10px;
  line-height: 1.6;
  color: $text-secondary;
  word-break: break-all;
}

@media (max-width: 1360px) {
  .trace-edit__layout {
    grid-template-columns: 280px minmax(0, 1fr) 380px;
  }
}

@media (max-width: 1200px) {
  .trace-edit__layout {
    grid-template-columns: 260px minmax(0, 1fr);
  }

  .trace-edit__preview {
    position: static;
    grid-column: 1 / -1;
  }
}

@media (max-width: 900px) {
  .trace-edit__layout {
    grid-template-columns: 1fr;
  }

  .trace-edit__list {
    position: static;
    max-height: none;
  }
}
</style>
