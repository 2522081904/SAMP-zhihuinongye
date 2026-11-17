<script setup>
/**
 * P015 农事计划管理
 * 数据来源：A11 农事计划（GET/POST /farm/plans）、A11 派单（POST /farm/plans/{id}/dispatch）、
 *          A11 工单（GET /farm/tasks）、A12 打卡记录（GET /farm/records）、A10 地块（GET /gis/plots）。
 * 数据缺口：
 * - A11 没有农事类型与「是否需要打卡」字段，类型按标题关键词推导，打卡开关仅表单采集；
 * - 状态只有 DRAFT/DISPATCHED/DOING/DONE/CANCELLED，筛选项「未开始」由前两者合并；
 * - 工单数由工单列表按 planId 聚合；mock 派单会为每位作业人员各生成一条工单。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，逾期判断不使用 Date.now。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  createFarmPlan,
  dispatchFarmPlan,
  fetchFarmPlans,
  fetchFarmRecords,
  fetchFarmTasks,
  fetchPlots
} from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'FarmPlanListPage' })

// mock 固定业务时间：真实联调时应替换为接口返回的服务器时间
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_NOW = toTimestamp(BUSINESS_NOW_TEXT)

// 农事类型：A11 未提供该字段，按标题关键词推导
const WORK_TYPE_RULES = [
  { type: '整枝', keys: ['整枝', '打杈', '修剪', '疏花', '疏果'] },
  { type: '采收', keys: ['采收', '采摘', '分级'] },
  { type: '打药', keys: ['打药', '病虫', '防控', '消毒', '用药'] },
  { type: '施肥', keys: ['施肥', '追肥', '水肥', '营养'] },
  { type: '灌溉', keys: ['灌溉', '滴灌', '浇水', '放风', '降湿'] },
  { type: '播种', keys: ['播种', '育苗', '移栽', '定植'] }
]

// 计划状态展示映射：AgriStatusTag 内置映射不含农事状态
const PLAN_STATUS_MAP = {
  DRAFT: { text: '草稿', type: 'info' },
  DISPATCHED: { text: '已派单', type: 'warning' },
  DOING: { text: '执行中', type: 'primary' },
  DONE: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' }
}

// 派单候选人：与 mock 农户名册保持一致
const WORKER_NAMES = ['张伟', '李强', '王芳', '赵敏', '刘洋', '陈晨', '周涛', '孙丽']

// 筛选与列表
const query = ref({ keyword: '', crop: '', plotId: '', status: '', dateRange: [] })
const page = ref(1)
const size = ref(10)
const plans = ref([])
const tasks = ref([])
const plots = ref([])
const loading = ref(false)
const loadError = ref(false)

// 新建计划弹窗（A11 不支持 datetime 字段，这里用自建表单）
const createVisible = ref(false)
const creating = ref(false)
const createFormRef = ref(null)
const createForm = reactive({
  title: '',
  plotId: '',
  crop: '',
  workType: '播种',
  startAt: '',
  endAt: '',
  owner: '',
  remark: '',
  needCheckin: true
})

// 派单弹窗
const dispatchVisible = ref(false)
const dispatchPlan = ref(null)
const dispatchWorkers = ref([])
const dispatching = ref(false)

// 详情抽屉
const detailVisible = ref(false)
const detailPlan = ref(null)
const detailTasks = ref([])
const detailRecords = ref([])
const detailLoading = ref(false)

/** 时间串转毫秒，兼容 Safari 的连字符日期 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 由标题推导农事类型 */
function workTypeOf(plan) {
  const title = String(plan?.title || '')
  const matched = WORK_TYPE_RULES.find((rule) => rule.keys.some((key) => title.includes(key)))
  return matched ? matched.type : '其他'
}

/** 计划结束时间（yyyy-MM-dd HH:mm:ss） */
function endAtOf(plan) {
  return `${plan.planDate} ${plan.endTime || '23:59'}:00`
}

/** 某计划的工单数 */
function taskCountOf(planId) {
  return tasks.value.filter((task) => task.planId === planId).length
}

/** 作物下拉：从地块字典去重 */
const cropOptions = computed(() => {
  const crops = [...new Set(plots.value.map((plot) => plot.crop).filter(Boolean))]
  return crops.map((crop) => ({ label: crop, value: crop }))
})

/** 地块下拉 */
const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: `${plot.name}（${plot.crop}）`, value: plot.id }))
)

/** 负责人下拉：固定名册 + 已有数据里出现过的负责人 */
const ownerOptions = computed(() => {
  const names = new Set(WORKER_NAMES)
  plans.value.forEach((plan) => {
    if (plan.owner) {
      names.add(plan.owner)
    }
  })
  tasks.value.forEach((task) => {
    if (task.assignee) {
      names.add(task.assignee)
    }
  })
  return [...names].map((name) => ({ label: name, value: name }))
})

/** 派单候选人：名册 + 当前计划已有作业人员 */
const workerOptions = computed(() => {
  const names = new Set(WORKER_NAMES)
  const plan = dispatchPlan.value
  ;(plan?.workers || []).forEach((name) => names.add(name))
  ;(plan ? tasks.value.filter((task) => task.planId === plan.id) : []).forEach((task) => {
    if (task.assignee) {
      names.add(task.assignee)
    }
  })
  return [...names].map((name) => ({ label: name, value: name }))
})

const searchFields = computed(() => [
  {
    prop: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '计划编号 / 名称 / 负责人',
    width: 230
  },
  {
    prop: 'crop',
    label: '作物',
    type: 'select',
    placeholder: '全部作物',
    options: cropOptions.value,
    width: 150
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
    prop: 'status',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { label: '未开始', value: 'NOT_STARTED' },
      { label: '进行中', value: 'DOING' },
      { label: '已完成', value: 'DONE' },
      { label: '已取消', value: 'CANCELLED' }
    ],
    width: 140
  },
  { prop: 'dateRange', label: '计划时间', type: 'daterange' }
])

const columns = [
  { prop: 'planNo', label: '计划编号', width: 118 },
  { prop: 'title', label: '计划名称', width: 150, showOverflowTooltip: true },
  { prop: 'plotName', label: '地块', width: 112, showOverflowTooltip: true },
  { prop: 'crop', label: '作物', width: 70 },
  { prop: 'workType', label: '农事类型', width: 76, slot: 'workType' },
  { prop: 'planTime', label: '计划时间', width: 144, slot: 'planTime' },
  { prop: 'owner', label: '负责人', width: 70 },
  { prop: 'taskCount', label: '工单数', width: 62, align: 'center' },
  { prop: 'status', label: '状态', width: 82, slot: 'status' },
  { prop: 'action', label: '操作', width: 128, slot: 'action', align: 'center' }
]

// 前端筛选：状态「未开始」需要合并两种后端状态，因此一次拉全量后本地过滤
const filteredPlans = computed(() => {
  const keyword = query.value.keyword.trim().toLowerCase()
  const from = query.value.dateRange?.[0]?.slice(0, 10) || ''
  const to = query.value.dateRange?.[1]?.slice(0, 10) || ''
  return plans.value.filter((plan) => {
    const matchKeyword =
      !keyword ||
      [plan.planNo, plan.title, plan.owner, plan.plotName].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(keyword)
      )
    const matchCrop = !query.value.crop || plan.crop === query.value.crop
    const matchPlot = !query.value.plotId || plan.plotId === query.value.plotId
    const matchStatus =
      !query.value.status ||
      (query.value.status === 'NOT_STARTED'
        ? plan.status === 'DRAFT' || plan.status === 'DISPATCHED'
        : plan.status === query.value.status)
    const matchDate = (!from || plan.planDate >= from) && (!to || plan.planDate <= to)
    return matchKeyword && matchCrop && matchPlot && matchStatus && matchDate
  })
})

const pagedPlans = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredPlans.value.slice(start, start + size.value)
})

const stats = computed(() => {
  const month = BUSINESS_NOW_TEXT.slice(0, 7)
  return {
    monthCount: plans.value.filter((plan) => String(plan.planDate).startsWith(month)).length,
    doing: plans.value.filter((plan) => plan.status === 'DOING').length,
    done: plans.value.filter((plan) => plan.status === 'DONE').length,
    overdue: plans.value.filter(
      (plan) =>
        plan.status !== 'DONE' &&
        plan.status !== 'CANCELLED' &&
        toTimestamp(endAtOf(plan)) < BUSINESS_NOW
    ).length
  }
})

const statCards = computed(() => [
  {
    label: '本月计划数',
    value: stats.value.monthCount,
    unit: '条',
    icon: 'Calendar',
    tone: 'brand'
  },
  { label: '进行中', value: stats.value.doing, unit: '条', icon: 'VideoPlay', tone: 'ok' },
  { label: '已完成', value: stats.value.done, unit: '条', icon: 'CircleCheck', tone: 'ok' },
  { label: '逾期', value: stats.value.overdue, unit: '条', icon: 'Warning', tone: 'danger' }
])

const emptyText = computed(() => {
  const hasFilter =
    query.value.keyword ||
    query.value.crop ||
    query.value.plotId ||
    query.value.status ||
    (query.value.dateRange && query.value.dateRange.length)
  return hasFilter
    ? '暂无匹配的农事计划，试试调整筛选条件'
    : '暂无农事计划，点击右上角「新建计划」开始编排'
})

const createRules = {
  title: [
    { required: true, message: '请输入计划名称', trigger: 'blur' },
    { max: 30, message: '计划名称不超过 30 个字', trigger: 'blur' }
  ],
  plotId: [{ required: true, message: '请选择地块', trigger: 'change' }],
  crop: [{ required: true, message: '请选择地块后自动带出作物', trigger: 'change' }],
  startAt: [{ required: true, message: '请选择计划开始时间', trigger: 'change' }],
  endAt: [
    { required: true, message: '请选择计划结束时间', trigger: 'change' },
    {
      validator: (_rule, value, callback) => {
        if (!value || !createForm.startAt) {
          callback()
          return
        }
        if (toTimestamp(value) <= toTimestamp(createForm.startAt)) {
          callback(new Error('结束时间必须晚于开始时间'))
          return
        }
        callback()
      },
      trigger: 'change'
    }
  ],
  owner: [{ required: true, message: '请选择负责人', trigger: 'change' }]
}

/** 载入计划、工单与地块：三者都需要用于统计与联动 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [planData, taskData, plotData] = await Promise.all([
      fetchFarmPlans({ page: 1, size: 100 }),
      fetchFarmTasks({ page: 1, size: 100 }),
      fetchPlots({ page: 1, size: 100 })
    ])
    plans.value = planData?.list || []
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

/** 查询：回到第 1 页 */
function handleSearch() {
  page.value = 1
}

/** 重置筛选 */
function handleReset() {
  query.value = { keyword: '', crop: '', plotId: '', status: '', dateRange: [] }
  page.value = 1
}

/** 分页事件：{ page, size } */
function handlePageChange(payload) {
  page.value = payload.page
  size.value = payload.size
}

/** 打开新建计划弹窗，默认排到业务当天上午 */
function openCreate() {
  const today = BUSINESS_NOW_TEXT.slice(0, 10)
  Object.assign(createForm, {
    title: '',
    plotId: '',
    crop: '',
    workType: '播种',
    startAt: `${today} 08:00:00`,
    endAt: `${today} 12:00:00`,
    owner: '',
    remark: '',
    needCheckin: true
  })
  createVisible.value = true
}

/** 地块变化：自动带出作物 */
function handlePlotChange(value) {
  const plot = plots.value.find((item) => item.id === value)
  createForm.crop = plot?.crop || ''
}

/** 提交新建计划：A11 只需要 planDate + startTime/endTime，时间拆成日期与时分 */
async function submitCreate() {
  if (!createFormRef.value || creating.value) {
    return
  }
  try {
    await createFormRef.value.validate()
  } catch {
    return
  }
  creating.value = true
  try {
    await createFarmPlan({
      title: createForm.title.trim(),
      plotId: createForm.plotId,
      planDate: createForm.startAt.slice(0, 10),
      startTime: createForm.startAt.slice(11, 16),
      endTime: createForm.endAt.slice(11, 16),
      owner: createForm.owner,
      workers: [createForm.owner],
      priority: 'NORMAL',
      remark: createForm.remark
    })
    ElMessage.success('农事计划已创建')
    createVisible.value = false
    page.value = 1
    await loadAll()
  } catch (err) {
    if (err?.code === 40401) {
      ElMessage.warning('地块不存在，请刷新后重试')
    }
  } finally {
    creating.value = false
  }
}

/** 打开派单弹窗：只有草稿状态可以派单 */
function openDispatch(row) {
  if (row.status !== 'DRAFT') {
    ElMessage.warning('仅草稿状态的计划可以派单')
    return
  }
  dispatchPlan.value = row
  dispatchWorkers.value = []
  dispatchVisible.value = true
}

/** 确认派单：按 A11 生成对应数量的工单 */
async function confirmDispatch() {
  if (!dispatchPlan.value || dispatching.value) {
    return
  }
  if (!dispatchWorkers.value.length) {
    ElMessage.warning('请至少选择一名作业人员')
    return
  }
  dispatching.value = true
  try {
    await dispatchFarmPlan(dispatchPlan.value.id, { workers: dispatchWorkers.value })
    ElMessage.success(`已派单给 ${dispatchWorkers.value.length} 人`)
    dispatchVisible.value = false
    await loadAll()
  } catch {
    // 非 40401 的失败已由请求拦截器统一提示
  } finally {
    dispatching.value = false
  }
}

/** 打开详情抽屉：关联工单取本地缓存，打卡记录单独请求 A12 */
async function openDetail(row) {
  detailPlan.value = row
  detailTasks.value = tasks.value.filter((task) => task.planId === row.id)
  detailRecords.value = []
  detailVisible.value = true
  detailLoading.value = true
  try {
    const data = await fetchFarmRecords({ page: 1, size: 100 })
    const taskIds = new Set(detailTasks.value.map((task) => task.id))
    detailRecords.value = (data?.list || []).filter((record) => taskIds.has(record.taskId))
  } catch (err) {
    if (err?.code !== 40401) {
      detailRecords.value = []
    }
  } finally {
    detailLoading.value = false
  }
}

/** 详情时间线：创建 → 派单 → 打卡 → 完成，按时间正序 */
const detailTimeline = computed(() => {
  const plan = detailPlan.value
  if (!plan) {
    return []
  }
  const items = [
    {
      time: plan.createdAt,
      title: '创建计划',
      description: `${plan.owner || '管理员'} 创建农事计划 ${plan.planNo}`
    }
  ]
  detailTasks.value.forEach((task) => {
    items.push({
      time: task.createdAt,
      title: '派发工单',
      description: `${task.taskNo} 指派给 ${task.assignee}`
    })
  })
  detailRecords.value.forEach((record) => {
    items.push({
      time: record.checkedAt || record.createdAt,
      title: '作业打卡',
      description: `${record.operator || '作业人'}：${record.content || '完成打卡'}`
    })
  })
  detailTasks.value.forEach((task) => {
    if (task.finishedAt) {
      items.push({ time: task.finishedAt, title: '工单完成', description: task.taskNo })
    }
  })
  return items
    .filter((item) => item.time)
    .sort((left, right) => {
      return toTimestamp(left.time) - toTimestamp(right.time)
    })
})

/** 编辑：A11 只有创建与派单，没有更新接口，这里明确提示并转到详情核对 */
function handleEdit(row) {
  ElMessage.info('A11 暂未提供计划编辑接口，已为你打开详情核对信息')
  openDetail(row)
}

/** 详情里的工单打卡状态 */
function checkinTextOf(task) {
  return task.checkinAt ? '已打卡' : '待打卡'
}

onMounted(() => {
  loadAll()
})
</script>

<template>
  <div class="page-container plan-list">
    <AgriPageHeader
      page-id="P015"
      title="农事计划管理"
      description="按地块与作物编排农事计划，安排播种、施肥、灌溉、打药、整枝与采收节点，支持派单与作业追踪。"
    >
      <template #extra>
        <el-button :loading="loading" @click="loadAll">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建计划</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="plan-list__stats">
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

    <div class="agri-card plan-list__section">
      <AgriSearchBar
        v-model="query"
        :fields="searchFields"
        :loading="loading"
        @search="handleSearch"
        @reset="handleReset"
      />
    </div>

    <div class="agri-card plan-list__section">
      <div class="plan-list__section-head">
        <h3 class="plan-list__section-title">农事计划</h3>
        <span class="text-secondary">共 {{ filteredPlans.length }} 条计划</span>
      </div>
      <div v-if="loadError" class="plan-list__error" @click="loadAll">加载失败，点击重试</div>
      <AgriTable
        v-else
        :columns="columns"
        :data="pagedPlans"
        :loading="loading"
        :total="filteredPlans.length"
        :page="page"
        :size="size"
        row-key="id"
        :empty-text="emptyText"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #workType="{ row }">
          <el-tag size="small" effect="plain">{{ workTypeOf(row) }}</el-tag>
        </template>
        <template #planTime="{ row }">
          <span class="plan-list__time"
            >{{ row.planDate }} {{ row.startTime }}-{{ row.endTime }}</span
          >
        </template>
        <template #taskCount="{ row }">{{ taskCountOf(row.id) }}</template>
        <template #status="{ row }">
          <AgriStatusTag :status="row.status" :map="PLAN_STATUS_MAP" />
        </template>
        <template #action="{ row }">
          <el-button
            link
            type="primary"
            :disabled="row.status !== 'DRAFT'"
            @click="openDispatch(row)"
          >
            派单
          </el-button>
          <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </AgriTable>
    </div>

    <!-- 新建计划：AgriFormDialog 不支持 datetime，用自建表单保证时间联动与校验 -->
    <el-dialog v-model="createVisible" title="新建农事计划" width="640px">
      <el-form
        ref="createFormRef"
        :model="createForm"
        :rules="createRules"
        label-width="112px"
        class="plan-list__form"
      >
        <el-form-item label="计划名称" prop="title">
          <el-input
            v-model="createForm.title"
            maxlength="30"
            show-word-limit
            placeholder="例如：番茄整枝打杈"
          />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="地块" prop="plotId">
              <el-select
                v-model="createForm.plotId"
                placeholder="请选择地块"
                filterable
                class="plan-list__full"
                @change="handlePlotChange"
              >
                <el-option
                  v-for="item in plotOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="作物" prop="crop">
              <el-input v-model="createForm.crop" disabled placeholder="选择地块后自动带出" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="农事类型" prop="workType">
              <el-select v-model="createForm.workType" class="plan-list__full">
                <el-option
                  v-for="type in ['播种', '施肥', '灌溉', '打药', '整枝', '采收']"
                  :key="type"
                  :label="type"
                  :value="type"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人" prop="owner">
              <el-select
                v-model="createForm.owner"
                placeholder="请选择负责人"
                filterable
                class="plan-list__full"
              >
                <el-option
                  v-for="item in ownerOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="开始时间" prop="startAt">
              <el-date-picker
                v-model="createForm.startAt"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="请选择开始时间"
                class="plan-list__full"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束时间" prop="endAt">
              <el-date-picker
                v-model="createForm.endAt"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DD HH:mm:ss"
                placeholder="请选择结束时间"
                class="plan-list__full"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="是否需要打卡">
          <el-switch v-model="createForm.needCheckin" />
          <span class="plan-list__tip">A11 暂未保存该字段，仅作为派单提示</span>
        </el-form-item>
        <el-form-item label="作业说明" prop="remark">
          <el-input
            v-model="createForm.remark"
            type="textarea"
            :rows="3"
            maxlength="120"
            show-word-limit
            placeholder="填写作业要求、注意事项"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">确定</el-button>
      </template>
    </el-dialog>

    <!-- 派单：AgriFormDialog 不支持多选，用自建 el-dialog + el-checkbox-group -->
    <el-dialog v-model="dispatchVisible" title="派发工单" width="520px">
      <div v-if="dispatchPlan" class="plan-list__dispatch">
        <p class="plan-list__dispatch-title">
          {{ dispatchPlan.planNo }} · {{ dispatchPlan.title }}
        </p>
        <p class="plan-list__tip">
          计划时间：{{ dispatchPlan.planDate }} {{ dispatchPlan.startTime }}-{{
            dispatchPlan.endTime
          }}；每位作业人员将生成一条工单。
        </p>
        <el-form label-width="88px">
          <el-form-item label="作业人员">
            <el-checkbox-group v-model="dispatchWorkers" class="plan-list__workers">
              <el-checkbox v-for="item in workerOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
        <p class="plan-list__tip">已选择 {{ dispatchWorkers.length }} 人</p>
      </div>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :loading="dispatching" @click="confirmDispatch">
          确认派单
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉：计划信息 + 关联工单 + 作业时间线 -->
    <el-drawer v-model="detailVisible" title="农事计划详情" size="640px">
      <div v-loading="detailLoading" class="plan-list__detail">
        <template v-if="detailPlan">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="计划编号">
              {{ detailPlan.planNo }}
            </el-descriptions-item>
            <el-descriptions-item label="计划名称">
              {{ detailPlan.title }}
            </el-descriptions-item>
            <el-descriptions-item label="地块">
              {{ detailPlan.plotName }}
            </el-descriptions-item>
            <el-descriptions-item label="作物">
              {{ detailPlan.crop }}
            </el-descriptions-item>
            <el-descriptions-item label="农事类型">
              {{ workTypeOf(detailPlan) }}
            </el-descriptions-item>
            <el-descriptions-item label="计划时间">
              {{ detailPlan.planDate }} {{ detailPlan.startTime }}-{{ detailPlan.endTime }}
            </el-descriptions-item>
            <el-descriptions-item label="负责人">
              {{ detailPlan.owner || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <AgriStatusTag :status="detailPlan.status" :map="PLAN_STATUS_MAP" />
            </el-descriptions-item>
            <el-descriptions-item label="作业说明" :span="2">
              {{ detailPlan.remark || '-' }}
            </el-descriptions-item>
          </el-descriptions>

          <h4 class="plan-list__detail-title">关联工单（{{ detailTasks.length }}）</h4>
          <el-table v-if="detailTasks.length" :data="detailTasks" size="small" border>
            <el-table-column prop="taskNo" label="工单号" min-width="118" />
            <el-table-column prop="assignee" label="作业人" width="72" />
            <el-table-column prop="checkinAt" label="打卡时间" min-width="140">
              <template #default="{ row }">{{ row.checkinAt || '-' }}</template>
            </el-table-column>
            <el-table-column label="打卡状态" width="82">
              <template #default="{ row }">
                <el-tag size="small" :type="row.checkinAt ? 'success' : 'info'" effect="plain">
                  {{ checkinTextOf(row) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <AgriEmpty v-else description="尚未派单，暂无关联工单" :height="120" />

          <h4 class="plan-list__detail-title">作业记录时间线</h4>
          <el-timeline v-if="detailTimeline.length">
            <el-timeline-item
              v-for="(item, index) in detailTimeline"
              :key="index"
              :timestamp="item.time"
              placement="top"
            >
              <p class="plan-list__timeline-title">{{ item.title }}</p>
              <p class="plan-list__timeline-desc">{{ item.description }}</p>
            </el-timeline-item>
          </el-timeline>
          <AgriEmpty v-else description="暂无作业记录" :height="120" />
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.plan-list__stats {
  margin-bottom: $space-md;
}

.plan-list__stats :deep(.el-col) {
  margin-bottom: $space-md;
}

.plan-list__section {
  margin-bottom: $space-md;
}

.plan-list__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.plan-list__section-title {
  margin: 0;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.plan-list__time {
  white-space: nowrap;
  font-size: $font-size-xs;
}

.plan-list__full {
  width: 100%;
}

.plan-list__form {
  padding-top: $space-xs;
}

.plan-list__tip {
  margin-left: 8px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.plan-list__dispatch-title {
  margin: 0 0 6px;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.plan-list__workers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.plan-list__detail-title {
  margin: $space-lg 0 $space-sm;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.plan-list__timeline-title {
  margin: 0 0 2px;
  font-size: $font-size-sm;
  color: $text-primary;
}

.plan-list__timeline-desc {
  margin: 0;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.plan-list__error {
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
