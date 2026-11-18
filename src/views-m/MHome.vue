<script setup>
/**
 * M001 移动端工作台
 * 数据来源：A11 工单（GET /farm/tasks）、A12 打卡记录（GET /farm/records）、
 *           A19 告警（GET /alarms）、A02 当前用户（GET /auth/me）。
 * 数据缺口与口径：
 * - A02 没有「所属园区」字段，园区名用演示常量；
 * - A11 工单不带「是否今日」标识，用 A19 最新一条告警的 createdAt 反推业务当天，
 *   再按工单 plannedAt 的日期过滤（mock 业务时间固定为 2026-11-16 18:30:00）；
 * - A12 打卡记录没有审核状态，本页只用于判断「今天是否已打卡」；
 * - 待打卡数 = 今日未取消、且今天还没有打卡记录的工单数。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { fetchAlarms, fetchFarmRecords, fetchFarmTasks } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'MobileHomePage' })

// 业务当天兜底值：A19 告警为空时使用，与 mock 固定业务时间保持一致
const BUSINESS_TODAY_FALLBACK = '2026-11-16'
// A02 没有园区字段，演示环境固定展示所属园区
const PARK_NAME = '江宁谷里现代农业示范园'
// 星期文案
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 工单状态业务态映射：AgriStatusTag 内置的 PENDING 含义是「待处置」
const TASK_STATUS_MAP = {
  PENDING: { text: '待执行', type: 'warning' },
  DOING: { text: '进行中', type: 'primary' },
  DONE: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'info' }
}

// 快捷入口 2×2 宫格
const QUICK_ENTRIES = [
  { key: 'checkin', glyph: '打', label: '农事打卡', hint: '上传作业现场', path: '/m/checkin' },
  { key: 'scan', glyph: '扫', label: '扫码溯源', hint: '查询产品档案', path: '/trace/scan' },
  { key: 'env', glyph: '测', label: '设备监测', hint: '温室环境实况', path: '/iot/env' },
  { key: 'alarm', glyph: '警', label: '告警中心', hint: '处置异常告警', path: '/iot/alerts' }
]

const router = useRouter()
const userStore = useUserStore()

const alarms = ref([])
const tasks = ref([])
const records = ref([])
const loading = ref(false)
const loadError = ref(false)

/** 日期串转 Date（用 / 分隔，兼容 Safari） */
function parseDate(text) {
  return text ? new Date(String(text).slice(0, 10).replace(/-/g, '/')) : null
}

/** 取时分，例如 2026-11-16 18:15:00 → 18:15 */
function formatClock(text) {
  const value = String(text || '')
  return value.length >= 16 ? value.slice(11, 16) : '-'
}

// 业务当天：用接口返回的最新告警时间推算，不依赖本机时间
const today = computed(() => {
  const latest = alarms.value[0]?.createdAt
  return latest ? String(latest).slice(0, 10) : BUSINESS_TODAY_FALLBACK
})

const todayLabel = computed(() => {
  const parts = today.value.split('-')
  return parts.length === 3 ? `${Number(parts[1])}月${Number(parts[2])}日` : today.value
})

const weekLabel = computed(() => {
  const date = parseDate(today.value)
  return date && !Number.isNaN(date.getTime()) ? WEEK_LABELS[date.getDay()] : ''
})

// 今日打卡记录与已打卡工单集合
const todayRecords = computed(() =>
  records.value.filter((record) => String(record.checkedAt).slice(0, 10) === today.value)
)
const checkedTaskIds = computed(
  () => new Set(todayRecords.value.map((record) => Number(record.taskId)))
)

// 今日工单：按 plannedAt 的日期过滤，时间倒序
const todayTasks = computed(() =>
  tasks.value
    .filter((task) => String(task.plannedAt).slice(0, 10) === today.value)
    .sort((left, right) => String(right.plannedAt).localeCompare(String(left.plannedAt)))
)
const visibleTasks = computed(() => todayTasks.value.slice(0, 5))

// 待打卡：今日未取消、且今天还没有打卡记录的工单
const pendingCheckinCount = computed(
  () =>
    todayTasks.value.filter(
      (task) => task.status !== 'CANCELLED' && !checkedTaskIds.value.has(Number(task.id))
    ).length
)

// 未处置告警（A19 已按 createdAt 倒序，这里仍按时间兜底排序）
const pendingAlarms = computed(() => alarms.value.filter((alarm) => alarm.status === 'PENDING'))
const latestPendingAlarm = computed(() => pendingAlarms.value[0] || null)

const overviewCards = computed(() => [
  { key: 'task', label: '今日工单', value: todayTasks.value.length, tone: 'brand' },
  { key: 'checkin', label: '待打卡', value: pendingCheckinCount.value, tone: 'warn' },
  { key: 'alarm', label: '未处置告警', value: pendingAlarms.value.length, tone: 'danger' }
])

const userName = computed(() => userStore.userInfo?.name || '系统管理员')

/**
 * 拉取工作台数据。
 * mock 适配器返回 db 内的对象引用，页面只读取快照，不修改列表字段。
 */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const [taskPage, recordPage, alarmPage] = await Promise.all([
      fetchFarmTasks({ page: 1, size: 100 }),
      fetchFarmRecords({ page: 1, size: 100 }),
      fetchAlarms({ page: 1, size: 100 })
    ])
    tasks.value = taskPage.list || []
    records.value = recordPage.list || []
    alarms.value = (alarmPage.list || [])
      .slice()
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  } catch {
    // 拦截器已统一提示，这里只切换页面错误态
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/** 跳转打卡页并带上工单号 */
function goCheckin(task) {
  if (task.status === 'CANCELLED') {
    return
  }
  router.push({ path: '/m/checkin', query: { taskId: String(task.id) } })
}

/** 快捷入口与告警条跳转 */
function goPath(path) {
  router.push(path)
}

onMounted(() => {
  loadAll()
  // 移动端布局不预取档案，本页自己补一次；失败不影响工单与告警展示
  userStore.fetchProfile()
})
</script>

<template>
  <div class="m-page m-home">
    <AgriPageHeader
      page-id="M001"
      title="移动端工作台"
      description="今日工单、待打卡与告警一屏掌握"
    />

    <section class="welcome">
      <div class="welcome__main">
        <p class="welcome__hello">{{ userName }}</p>
        <p class="welcome__park">{{ PARK_NAME }}</p>
      </div>
      <div class="welcome__date">
        <span class="welcome__date-day">{{ todayLabel }}</span>
        <span class="welcome__date-week">{{ weekLabel }}</span>
      </div>
    </section>

    <div v-if="loadError" class="load-error">
      <p class="load-error__text">工作台数据加载失败，请重试</p>
      <el-button type="primary" plain @click="loadAll">重新加载</el-button>
    </div>

    <section class="m-section">
      <h3 class="m-section__title">今日概览</h3>
      <div class="stat-row">
        <div
          v-for="card in overviewCards"
          :key="card.key"
          class="stat-card"
          :class="`is-${card.tone}`"
        >
          <span class="stat-card__value">{{ loading ? '—' : card.value }}</span>
          <span class="stat-card__label">{{ card.label }}</span>
        </div>
      </div>
    </section>

    <section class="m-section">
      <h3 class="m-section__title">快捷入口</h3>
      <div class="quick-grid">
        <button
          v-for="entry in QUICK_ENTRIES"
          :key="entry.key"
          type="button"
          class="quick-entry"
          @click="goPath(entry.path)"
        >
          <span class="quick-entry__glyph">{{ entry.glyph }}</span>
          <span class="quick-entry__text">
            <span class="quick-entry__label">{{ entry.label }}</span>
            <span class="quick-entry__hint">{{ entry.hint }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="m-section">
      <div class="m-section__head">
        <h3 class="m-section__title">今日工单</h3>
        <span class="m-section__extra">共 {{ todayTasks.length }} 条</span>
      </div>
      <div class="task-card">
        <ul v-if="visibleTasks.length" class="task-list">
          <li v-for="task in visibleTasks" :key="task.id" class="task-item">
            <div class="task-item__main">
              <p class="task-item__title">{{ task.title }}</p>
              <p class="task-item__meta">{{ task.plotName }} · {{ task.assignee }}</p>
            </div>
            <div class="task-item__side">
              <AgriStatusTag :status="task.status" :map="TASK_STATUS_MAP" />
              <button
                type="button"
                class="task-item__action"
                :disabled="task.status === 'CANCELLED'"
                @click="goCheckin(task)"
              >
                去打卡
              </button>
            </div>
          </li>
        </ul>
        <AgriEmpty v-else description="今日暂无工单" height="140px" />
      </div>
    </section>

    <button
      type="button"
      class="alarm-strip"
      :class="{ 'is-empty': !latestPendingAlarm }"
      @click="goPath('/iot/alerts')"
    >
      <template v-if="latestPendingAlarm">
        <span class="alarm-strip__level">{{ latestPendingAlarm.levelName }}告警</span>
        <span class="alarm-strip__content">{{ latestPendingAlarm.content }}</span>
        <span class="alarm-strip__time">{{ formatClock(latestPendingAlarm.createdAt) }}</span>
      </template>
      <span v-else class="alarm-strip__content">今日无未处置告警</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.m-home {
  padding-bottom: 24px;
}

.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  margin-bottom: 12px;
  color: #fff;
  background: linear-gradient(135deg, $primary-color, $primary-light);
  border-radius: $radius-md;
  box-shadow: $shadow-card;
}

.welcome__hello {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.welcome__park {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.4;
  opacity: 0.88;
}

.welcome__date {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: flex-end;
  gap: 2px;
}

.welcome__date-day {
  font-size: 15px;
  font-weight: 600;
}

.welcome__date-week {
  font-size: 13px;
  opacity: 0.85;
}

.load-error {
  padding: 12px;
  margin-bottom: 12px;
  text-align: center;
  background-color: #fef0f0;
  border-radius: $radius-md;
}

.load-error :deep(.el-button) {
  min-height: 44px;
}

.load-error__text {
  margin-bottom: 8px;
  font-size: 13px;
  color: $danger-color;
}

.m-section {
  margin-bottom: 16px;
}

.m-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.m-section__title {
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 600;
  color: $text-primary;
}

.m-section__head .m-section__title {
  margin-bottom: 0;
}

.m-section__extra {
  font-size: 13px;
  color: $text-secondary;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 76px;
  padding: 12px 6px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
  color: $primary-color;
}

.stat-card.is-warn .stat-card__value {
  color: $warning-color;
}

.stat-card.is-danger .stat-card__value {
  color: $danger-color;
}

.stat-card__label {
  font-size: 13px;
  line-height: 1.2;
  color: $text-secondary;
  white-space: nowrap;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.quick-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  background-color: $bg-card;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.quick-entry:active {
  background-color: $primary-lighter;
}

.quick-entry__glyph {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 15px;
  font-weight: 600;
  color: $primary-color;
  background-color: $primary-lighter;
  border-radius: 50%;
}

.quick-entry__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.quick-entry__label {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
}

.quick-entry__hint {
  overflow: hidden;
  font-size: 13px;
  color: $text-secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card {
  padding: 0 12px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.task-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid $border-color;
}

.task-item:last-child {
  border-bottom: none;
}

.task-item__main {
  flex: 1;
  min-width: 0;
}

.task-item__title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item__meta {
  margin-top: 4px;
  overflow: hidden;
  font-size: 13px;
  color: $text-secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item__side {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: flex-end;
  gap: 6px;
}

.task-item__action {
  min-width: 76px;
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
  color: #fff;
  cursor: pointer;
  background-color: $primary-color;
  border: none;
  border-radius: $radius-sm;
}

.task-item__action:disabled {
  color: $text-secondary;
  cursor: not-allowed;
  background-color: #f0f2f5;
}

.alarm-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  background-color: #fdf6ec;
  border: none;
  border-left: 3px solid $warning-color;
  border-radius: $radius-sm;
}

.alarm-strip.is-empty {
  background-color: $bg-card;
  border: 1px solid $border-color;
  border-left: 3px solid $border-color;
}

.alarm-strip__level {
  flex-shrink: 0;
  padding: 2px 6px;
  font-size: 13px;
  color: #fff;
  background-color: $warning-color;
  border-radius: $radius-sm;
}

.alarm-strip__content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  color: $text-regular;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alarm-strip.is-empty .alarm-strip__content {
  color: $text-secondary;
}

.alarm-strip__time {
  flex-shrink: 0;
  font-size: 13px;
  color: $text-secondary;
}
</style>
