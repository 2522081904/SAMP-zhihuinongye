<script setup>
/**
 * P016 农事工单与打卡
 * 数据来源：A11 工单（GET /farm/tasks）、A10 地块（GET /gis/plots）。
 * 数据缺口：
 * - A11 工单没有打卡照片、工时与审核字段，照片用确定性的 SVG 占位图，
 *   工时由 checkinAt/finishedAt 计算，审核结果保存在本机 sessionStorage；
 * - 没有工单审核接口，审核只改变页面展示状态，不回写 mock 数据；
 * - 「今日打卡」严格按业务当天（2026-11-16）统计，种子数据当天没有打卡记录时为 0，
 *   「异常打卡」按「计划时间已过但仍未打卡」统计。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与判断。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { fetchFarmTasks, fetchPlots } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmTaskListPage' })

const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_NOW = toTimestamp(BUSINESS_NOW_TEXT)
const HOUR_MS = 60 * 60 * 1000
const REVIEW_KEY = 'agri-farm-task-review-v1'

// 审核状态展示映射：AgriStatusTag 内置映射不含待审核/已驳回
const REVIEW_STATUS_MAP = {
  PENDING: { text: '待审核', type: 'warning' },
  PASS: { text: '已通过', type: 'success' },
  REJECT: { text: '已驳回', type: 'danger' },
  NONE: { text: '未打卡', type: 'info' }
}

// 工单状态映射（详情抽屉使用）
const TASK_STATUS_MAP = {
  PENDING: { text: '待执行', type: 'info' },
  DOING: { text: '进行中', type: 'primary' },
  DONE: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' }
}

const query = ref({ keyword: '', plotId: '', assignee: '', reviewStatus: '', dateRange: [] })
const page = ref(1)
const size = ref(10)
const tasks = ref([])
const plots = ref([])
const loading = ref(false)
const loadError = ref(false)
const selectedRows = ref([])
const tableKey = ref(0)

// 审核结果：{ [taskId]: { result, rejectReason, comment, reviewedAt, reviewer } }
const reviews = ref({})

// 审核弹窗
const reviewVisible = ref(false)
const reviewTask = ref(null)
const reviewSubmitting = ref(false)
const reviewDefaults = ref({ result: 'PASS', rejectReason: '', comment: '' })
const reviewForm = reactive({ result: 'PASS', rejectReason: '', comment: '' })

// 详情抽屉
const detailVisible = ref(false)
const detailTask = ref(null)

/** 时间串转毫秒 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 读取本机审核覆盖态 */
function loadReviews() {
  try {
    const raw = sessionStorage.getItem(REVIEW_KEY)
    reviews.value = raw ? JSON.parse(raw) : {}
  } catch {
    reviews.value = {}
  }
}

/** 保存审核覆盖态 */
function persistReviews() {
  try {
    sessionStorage.setItem(REVIEW_KEY, JSON.stringify(reviews.value))
  } catch {
    // 隐私模式下不可写时只保留内存态
  }
}

/** 审核状态：已审核优先，其次看是否打卡 */
function reviewStateOf(task) {
  const overlay = reviews.value[task.id]
  if (overlay?.result) {
    return overlay.result
  }
  return task.checkinAt ? 'PENDING' : 'NONE'
}

/** 地块下拉 */
const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

/** 作业人下拉 */
const assigneeOptions = computed(() => {
  const names = [...new Set(tasks.value.map((task) => task.assignee).filter(Boolean))]
  return names.map((name) => ({ label: name, value: name }))
})

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '工单号 / 计划名称 / 作业人',
    width: 230
  },
  {
    prop: 'plotId',
    label: '地块',
    type: 'select',
    placeholder: '全部地块',
    options: plotOptions.value,
    width: 210
  },
  {
    prop: 'assignee',
    label: '作业人',
    type: 'select',
    placeholder: '全部作业人',
    options: assigneeOptions.value,
    width: 140
  },
  {
    prop: 'reviewStatus',
    label: '审核状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '待审核', value: 'PENDING' },
      { label: '已通过', value: 'PASS' },
      { label: '已驳回', value: 'REJECT' }
    ],
    width: 140
  },
  { prop: 'dateRange', label: '计划日期', type: 'daterange' }
])

const columns = [
  { prop: 'taskNo', label: '工单号', width: 118 },
  { prop: 'title', label: '计划名称', width: 150, showOverflowTooltip: true },
  { prop: 'plotName', label: '地块', width: 100, showOverflowTooltip: true },
  { prop: 'assignee', label: '作业人', width: 72 },
  { prop: 'plannedAt', label: '计划时间', width: 134 },
  { prop: 'checkinAt', label: '打卡时间', width: 134 },
  { prop: 'photo', label: '打卡照片', width: 58, slot: 'photo', align: 'center' },
  { prop: 'workHours', label: '工时', width: 58, slot: 'workHours', align: 'center' },
  { prop: 'review', label: '审核状态', width: 86, slot: 'review' },
  { prop: 'action', label: '操作', width: 110, slot: 'action', align: 'center' }
]

const filteredTasks = computed(() => {
  const keyword = query.value.keyword.trim().toLowerCase()
  const from = query.value.dateRange?.[0]?.slice(0, 10) || ''
  const to = query.value.dateRange?.[1]?.slice(0, 10) || ''
  return tasks.value.filter((task) => {
    const matchKeyword =
      !keyword ||
      [task.taskNo, task.title, task.assignee, task.planNo].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchPlot = !query.value.plotId || task.plotId === query.value.plotId
    const matchAssignee = !query.value.assignee || task.assignee === query.value.assignee
    const matchReview =
      !query.value.reviewStatus || reviewStateOf(task) === query.value.reviewStatus
    const date = String(task.plannedAt || '').slice(0, 10)
    const matchDate = (!from || date >= from) && (!to || date <= to)
    return matchKeyword && matchPlot && matchAssignee && matchReview && matchDate
  })
})

const pagedTasks = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredTasks.value.slice(start, start + size.value)
})

const stats = computed(() => {
  const today = BUSINESS_NOW_TEXT.slice(0, 10)
  return {
    pending: tasks.value.filter((task) => task.status === 'PENDING').length,
    checkedToday: tasks.value.filter((task) => String(task.checkinAt).startsWith(today)).length,
    toReview: tasks.value.filter((task) => reviewStateOf(task) === 'PENDING').length,
    abnormal: tasks.value.filter(
      (task) =>
        (task.status === 'PENDING' || task.status === 'DOING') &&
        !task.checkinAt &&
        toTimestamp(task.plannedAt) < BUSINESS_NOW
    ).length
  }
})

const statCards = computed(() => [
  { label: '待接单', value: stats.value.pending, unit: '条', icon: 'Tickets', tone: 'brand' },
  {
    label: '今日打卡',
    value: stats.value.checkedToday,
    unit: '次',
    icon: 'AlarmClock',
    tone: 'ok'
  },
  {
    label: '待审核',
    value: stats.value.toReview,
    unit: '条',
    icon: 'DocumentChecked',
    tone: 'warn'
  },
  { label: '异常打卡', value: stats.value.abnormal, unit: '条', icon: 'Warning', tone: 'danger' }
])

const emptyText = computed(() => {
  const hasFilter =
    query.value.keyword ||
    query.value.plotId ||
    query.value.assignee ||
    query.value.reviewStatus ||
    (query.value.dateRange && query.value.dateRange.length)
  return hasFilter ? '暂无匹配工单，试试调整筛选条件' : '暂无农事工单，请先在农事计划页派单'
})

/** 打卡照片：确定性 SVG 占位，不依赖外链图片 */
function photoOf(task) {
  if (!task.checkinAt) {
    return ''
  }
  const hue = (Number(task.id) * 37) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,45%)"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="60" y="66" font-size="14" fill="#ffffff" text-anchor="middle">${task.taskNo.slice(-4)} 打卡</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 工时：打卡后按 finishedAt 计算，未完成显示「进行中」 */
function workHoursOf(task) {
  if (!task.checkinAt) {
    return ''
  }
  if (!task.finishedAt) {
    return '进行中'
  }
  const hours = (toTimestamp(task.finishedAt) - toTimestamp(task.checkinAt)) / HOUR_MS
  return `${hours.toFixed(1)} h`
}

/** 载入工单与地块 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [taskData, plotData] = await Promise.all([
      fetchFarmTasks({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 100 })
    ])
    tasks.value = taskData?.list || []
    plots.value = plotData?.list || []
  } catch (err) {
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
}

function handleReset() {
  query.value = { keyword: '', plotId: '', assignee: '', reviewStatus: '', dateRange: [] }
  page.value = 1
}

function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

function handleSelectionChange(rows) {
  selectedRows.value = rows
}

/** 打开审核弹窗 */
function openReview(row) {
  if (!row.checkinAt) {
    ElMessage.warning('该工单尚未打卡，暂不能审核')
    return
  }
  reviewTask.value = row
  reviewForm.result = 'PASS'
  reviewForm.rejectReason = ''
  reviewForm.comment = ''
  reviewDefaults.value = { result: 'PASS', rejectReason: '', comment: '' }
  reviewVisible.value = true
}

/** AgriFormDialog 没有 v-model 表单，监听字段变化同步到本地校验闭包 */
function handleReviewFieldChange({ prop, value }) {
  if (prop in reviewForm) {
    reviewForm[prop] = value
  }
}

/** 驳回时必填原因 */
function validateRejectReason() {
  if (reviewForm.result === 'REJECT' && !reviewForm.rejectReason.trim()) {
    return '驳回时必须填写驳回原因'
  }
  return ''
}

const reviewRules = {
  rejectReason: [
    {
      validator: (_rule, _value, callback) => {
        const message = validateRejectReason()
        if (message) {
          callback(new Error(message))
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ]
}

/** 提交审核：写入本机覆盖态并刷新当前行展示 */
function submitReview(payload) {
  const task = reviewTask.value
  if (!task || reviewSubmitting.value) {
    return
  }
  if (payload.result === 'REJECT' && !String(payload.rejectReason || '').trim()) {
    ElMessage.warning('驳回时必须填写驳回原因')
    return
  }
  reviewSubmitting.value = true
  reviews.value = {
    ...reviews.value,
    [task.id]: {
      result: payload.result,
      rejectReason: String(payload.rejectReason || '').trim(),
      comment: String(payload.comment || '').trim(),
      reviewedAt: BUSINESS_NOW_TEXT,
      reviewer: '管理员'
    }
  }
  persistReviews()
  reviewVisible.value = false
  reviewSubmitting.value = false
  ElMessage.success(payload.result === 'PASS' ? '审核已通过' : '审核已驳回')
}

/** 批量通过：仅处理已打卡且未审核的工单 */
async function handleBatchPass() {
  const rows = selectedRows.value.filter(
    (task) => task.checkinAt && reviewStateOf(task) === 'PENDING'
  )
  if (!rows.length) {
    ElMessage.warning('请先勾选待审核且已打卡的工单')
    return
  }
  try {
    await ElMessageBox.confirm(`确认批量通过 ${rows.length} 条工单的审核吗？`, '批量通过', {
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  const next = { ...reviews.value }
  rows.forEach((task) => {
    next[task.id] = {
      result: 'PASS',
      rejectReason: '',
      comment: '批量审核通过',
      reviewedAt: BUSINESS_NOW_TEXT,
      reviewer: '管理员'
    }
  })
  reviews.value = next
  persistReviews()
  selectedRows.value = []
  tableKey.value += 1
  ElMessage.success(`已批量通过 ${rows.length} 条工单`)
}

/** 打开详情抽屉 */
function openDetail(row) {
  detailTask.value = row
  detailVisible.value = true
}

onMounted(() => {
  loadReviews()
  loadAll()
})
</script>

<template>
  <div class="page-container task-list">
    <AgriPageHeader
      page-id="P016"
      title="农事工单与打卡"
      description="查看派单生成的农事工单、作业打卡与照片留存，支持单条审核与批量通过。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="task-list__stats">
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

    <div class="agri-card task-list__section">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card task-list__section">
      <div class="task-list__section-head">
        <h3 class="task-list__section-title">工单列表</h3>
        <div class="task-list__section-tools">
          <span class="text-secondary">共 {{ filteredTasks.length }} 条工单</span>
          <el-button type="primary" plain :disabled="!selectedRows.length" @click="handleBatchPass">
            批量通过
          </el-button>
        </div>
      </div>
      <div v-if="loadError" class="task-list__error" @click="loadAll">加载失败，点击重试</div>
      <AgriTable
        v-else
        :key="tableKey"
        :columns="columns"
        :data="pagedTasks"
        :loading="loading"
        :total="filteredTasks.length"
        :page="page"
        :size="size"
        :selection="true"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
        @selection-change="handleSelectionChange"
      >
        <template #photo="{ row }">
          <el-image
            v-if="row.checkinAt"
            :src="photoOf(row)"
            :preview-src-list="[photoOf(row)]"
            preview-teleported
            fit="cover"
            class="task-list__photo"
          />
          <span v-else>-</span>
        </template>
        <template #workHours="{ row }">{{ workHoursOf(row) }}</template>
        <template #review="{ row }">
          <AgriStatusTag :status="reviewStateOf(row)" :map="REVIEW_STATUS_MAP" />
        </template>
        <template #action="{ row }">
          <el-button link type="primary" :disabled="!row.checkinAt" @click="openReview(row)">
            审核
          </el-button>
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 审核弹窗：字段驱动的通用表单，驳回原因用 validator 做条件必填 -->
    <AgriFormDialog
      v-model="reviewVisible"
      title="工单审核"
      :fields="[
        {
          prop: 'result',
          label: '审核结果',
          type: 'radio',
          required: true,
          options: [
            { label: '通过', value: 'PASS' },
            { label: '驳回', value: 'REJECT' }
          ],
          span: 2
        },
        {
          prop: 'rejectReason',
          label: '驳回原因',
          type: 'textarea',
          span: 2,
          tip: '选择驳回时必填，通过时可留空'
        },
        { prop: 'comment', label: '审核意见', type: 'textarea', span: 2 }
      ]"
      :rules="reviewRules"
      :default-values="reviewDefaults"
      :loading="reviewSubmitting"
      width="560px"
      submit-text="提交审核"
      @field-change="handleReviewFieldChange"
      @submit="submitReview"
    />

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="工单详情" size="560px">
      <div v-if="detailTask" class="task-list__detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="工单号">{{ detailTask.taskNo }}</el-descriptions-item>
          <el-descriptions-item label="计划名称">{{ detailTask.title }}</el-descriptions-item>
          <el-descriptions-item label="地块">{{ detailTask.plotName }}</el-descriptions-item>
          <el-descriptions-item label="作物">{{ detailTask.crop }}</el-descriptions-item>
          <el-descriptions-item label="作业人">{{ detailTask.assignee }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">
            {{ detailTask.assigneePhone || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="计划时间">
            {{ detailTask.plannedAt }}
          </el-descriptions-item>
          <el-descriptions-item label="工单状态">
            <AgriStatusTag :status="detailTask.status" :map="TASK_STATUS_MAP" />
          </el-descriptions-item>
          <el-descriptions-item label="打卡时间">
            {{ detailTask.checkinAt || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="打卡地点">
            {{ detailTask.checkinLocation || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="工时">{{
            workHoursOf(detailTask) || '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="审核状态">
            <AgriStatusTag :status="reviewStateOf(detailTask)" :map="REVIEW_STATUS_MAP" />
          </el-descriptions-item>
          <el-descriptions-item label="作业要求" :span="2">
            {{ detailTask.content || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="task-list__detail-title">打卡照片</h4>
        <el-image
          v-if="detailTask.checkinAt"
          :src="photoOf(detailTask)"
          :preview-src-list="[photoOf(detailTask)]"
          preview-teleported
          fit="cover"
          class="task-list__photo-large"
        />
        <AgriEmpty v-else description="该工单尚未打卡，暂无现场照片" :height="110" />

        <template v-if="reviews[detailTask.id]">
          <h4 class="task-list__detail-title">审核记录</h4>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="审核结果">
              <AgriStatusTag :status="reviews[detailTask.id].result" :map="REVIEW_STATUS_MAP" />
            </el-descriptions-item>
            <el-descriptions-item label="审核人">
              {{ reviews[detailTask.id].reviewer }}
            </el-descriptions-item>
            <el-descriptions-item label="审核时间" :span="2">
              {{ reviews[detailTask.id].reviewedAt }}
            </el-descriptions-item>
            <el-descriptions-item label="驳回原因" :span="2">
              {{ reviews[detailTask.id].rejectReason || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="审核意见" :span="2">
              {{ reviews[detailTask.id].comment || '-' }}
            </el-descriptions-item>
          </el-descriptions>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.task-list__stats {
  margin-bottom: $space-md;
}

.task-list__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.task-list__section {
  margin-bottom: $space-md;
}

.task-list__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.task-list__section-tools {
  display: flex;
  align-items: center;
  gap: $space-sm;
}

.task-list__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.task-list__photo {
  width: 38px;
  height: 38px;
  border-radius: $radius-sm;
  cursor: zoom-in;
}

.task-list__photo-large {
  width: 160px;
  height: 160px;
  border-radius: $radius-md;
  cursor: zoom-in;
}

.task-list__detail-title {
  margin: $space-lg 0 $space-sm;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.task-list__error {
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
  .task-list__section-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
