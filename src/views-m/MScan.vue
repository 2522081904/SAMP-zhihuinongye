<script setup>
/**
 * M003 扫码溯源查询（公开页，免登录）
 * 路由 /trace/scan 在 router/index.js 的 PUBLIC_PATHS 白名单内，未登录可直接打开。
 * 数据来源：A17 公开溯源（GET /trace/public/{code}，免登录）；
 *           「模拟扫码」用 A16 溯源码列表（GET /trace/codes）取一条真实存在的码。
 * 数据缺口与兜底：
 * - A17 时间线只有 { time, title, description }，没有操作人字段，操作人取批次上的 operator；
 * - A17 未返回基地名称，产地信息里的基地名用演示常量；
 * - A17 的「已召回」状态没有种子数据（现有 18 条只有 ACTIVE / VOID），
 *   召回提示按 status === 'RECALLED' 实现，便于后续数据接入。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchPublicTrace, fetchTraceCodes } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'

defineOptions({ name: 'MobileScanPage' })

// A17 没有基地名称字段，演示环境固定展示
const BASE_NAME = '江宁谷里现代农业示范园'

// 溯源码状态业务态映射
const TRACE_STATUS_MAP = {
  ACTIVE: { text: '有效', type: 'success' },
  RECALLED: { text: '已召回', type: 'danger' },
  INACTIVE: { text: '未激活', type: 'info' },
  PENDING: { text: '未激活', type: 'info' },
  VOID: { text: '已作废', type: 'info' }
}

// 检测结论业务态映射
const CONCLUSION_MAP = {
  PASS: { text: '合格', type: 'success' },
  FAIL: { text: '不合格', type: 'danger' }
}

const traceCode = ref('')
const trace = ref(null)
const queriedCode = ref('')
const loading = ref(false)
const scanning = ref(false)
const notFound = ref(false)
const errorText = ref('')
const expandedReports = ref([])

const batch = computed(() => trace.value?.batch || null)
const plot = computed(() => trace.value?.plot || null)
const company = computed(() => trace.value?.company || null)
const inspections = computed(() => trace.value?.inspections || [])
const isRecalled = computed(() => trace.value?.status === 'RECALLED')

// 产品名：批次作物 + 品种
const productName = computed(() =>
  batch.value ? `${batch.value.crop} · ${batch.value.variety}` : '未知产品'
)

// 时间线：A17 未保证顺序，这里按时间倒序
const timeline = computed(() =>
  (trace.value?.timeline || [])
    .slice()
    .sort((left, right) => String(right.time).localeCompare(String(left.time)))
)

// 时间线里的操作人：接口没有该字段，退化为批次负责人
const operatorName = computed(() => batch.value?.operator || '-')

// 溯源链说明（一句话）
const traceChain = computed(
  () =>
    `种植管理 → 采收分拣 → 农残检测 → 赋码上市，累计扫码 ${trace.value?.scanCount || 0} 次可查。`
)

/** 统一社会信用代码打码：保留前 4 位与后 4 位 */
function maskCreditCode(code) {
  const value = String(code || '')
  if (value.length <= 8) {
    return value || '-'
  }
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

/** 报告明细展开/收起 */
function toggleReport(reportId) {
  expandedReports.value = expandedReports.value.includes(reportId)
    ? expandedReports.value.filter((id) => id !== reportId)
    : [...expandedReports.value, reportId]
}

/**
 * 按溯源码查询公开档案。
 * @param {string} code 溯源码
 * @param {Object} [options] notify 为 true 时提示「已识别溯源码」
 */
async function queryByCode(code, options = {}) {
  const value = String(code || '').trim()
  if (!value) {
    ElMessage.warning('请输入溯源码')
    return
  }

  traceCode.value = value
  loading.value = true
  notFound.value = false
  errorText.value = ''
  trace.value = null
  queriedCode.value = value
  expandedReports.value = []

  try {
    const data = await fetchPublicTrace(value)
    trace.value = data || null
    if (!data) {
      notFound.value = true
    } else if (options.notify) {
      ElMessage.success(`已识别溯源码 ${value}`)
    }
  } catch (error) {
    // 40401 表示码不存在，走空态；其余错误走重试卡片
    if (Number(error?.code) === 40401) {
      notFound.value = true
    } else {
      errorText.value = error?.message || '查询失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

/** 模拟扫码：取 A16 列表里第一条有效溯源码并直接查询 */
async function simulateScan() {
  if (scanning.value || loading.value) {
    return
  }
  scanning.value = true
  try {
    const page = await fetchTraceCodes({ page: 1, size: 100 })
    const list = page.list || []
    const target = list.find((item) => item.status === 'ACTIVE') || list[0]
    if (!target) {
      ElMessage.warning('暂无可用的溯源码')
      return
    }
    // 溯源码列表字段是 code，公开档案字段是 traceCode
    await queryByCode(target.code, { notify: true })
  } catch {
    // 拦截器已统一提示
  } finally {
    scanning.value = false
  }
}

/** 重新查询当前码 */
function retryQuery() {
  queryByCode(queriedCode.value || traceCode.value)
}
</script>

<template>
  <div class="m-page m-scan">
    <AgriPageHeader
      page-id="M003"
      title="扫码溯源查询"
      description="扫码或输入溯源码，查看农产品全流程档案"
    />

    <section class="scan-panel">
      <div class="scan-frame">
        <svg class="scan-frame__icon" viewBox="0 0 48 48" aria-hidden="true">
          <path
            d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
          />
          <path
            d="M10 24h28"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.5"
          />
        </svg>
        <p class="scan-frame__text">将溯源码置于框内</p>
      </div>

      <el-button type="primary" class="scan-btn" :loading="scanning" @click="simulateScan">
        示例扫码
      </el-button>

      <div class="scan-input">
        <el-input
          v-model="traceCode"
          size="large"
          clearable
          placeholder="请输入溯源码，如 TC-20261116-0001"
          @keyup.enter="queryByCode(traceCode)"
        />
        <el-button
          type="primary"
          class="scan-input__btn"
          :loading="loading"
          @click="queryByCode(traceCode)"
        >
          查询
        </el-button>
      </div>
    </section>

    <div v-if="loading" class="result">
      <div v-for="item in 3" :key="item" class="trace-card">
        <el-skeleton :rows="3" animated />
      </div>
    </div>

    <div v-else-if="errorText" class="trace-card state-card">
      <p class="state-card__text">{{ errorText }}</p>
      <el-button type="primary" plain @click="retryQuery">重试</el-button>
    </div>

    <div v-else-if="notFound" class="trace-card state-card">
      <AgriEmpty description="未查询到该溯源码，请核对后重试" height="150px" />
      <el-button type="primary" plain @click="retryQuery">重新查询</el-button>
    </div>

    <div v-else-if="trace" class="result">
      <div v-if="isRecalled" class="recall-banner">该批次已召回，请勿食用</div>

      <section class="trace-card batch-card">
        <div class="batch-card__head">
          <div class="batch-card__main">
            <p class="batch-card__name">{{ productName }}</p>
            <p class="batch-card__no">批次号 {{ batch?.batchNo || '-' }}</p>
          </div>
          <AgriStatusTag :status="trace.status" :map="TRACE_STATUS_MAP" />
        </div>
        <p class="batch-card__code">溯源码：{{ trace.traceCode }}</p>
        <p class="batch-card__meta">
          累计扫码 {{ trace.scanCount }} 次 · 赋码于 {{ trace.createdAt }}
        </p>
      </section>

      <section class="trace-card">
        <h3 class="card-title">产地信息</h3>
        <dl class="info-list">
          <div class="info-row">
            <dt>基地名称</dt>
            <dd>{{ BASE_NAME }}</dd>
          </div>
          <div class="info-row">
            <dt>地块</dt>
            <dd>{{ plot?.plotName || '-' }}</dd>
          </div>
          <div class="info-row">
            <dt>面积</dt>
            <dd>{{ plot ? `${plot.areaMu} 亩` : '-' }}</dd>
          </div>
          <div class="info-row">
            <dt>负责人</dt>
            <dd>{{ plot?.manager || '-' }}</dd>
          </div>
          <div class="info-row">
            <dt>采收日期</dt>
            <dd>{{ batch?.harvestDate || '-' }}</dd>
          </div>
        </dl>
      </section>

      <section class="trace-card">
        <h3 class="card-title">农事记录</h3>
        <el-timeline v-if="timeline.length" class="trace-timeline">
          <el-timeline-item
            v-for="(item, index) in timeline"
            :key="`${item.time}-${index}`"
            :timestamp="item.time"
            placement="top"
            type="primary"
          >
            <p class="timeline__title">{{ item.title }}</p>
            <p class="timeline__desc">{{ item.description }}</p>
            <p class="timeline__operator">操作人：{{ operatorName }}</p>
          </el-timeline-item>
        </el-timeline>
        <AgriEmpty v-else description="暂无农事记录" height="130px" />
      </section>

      <section class="trace-card">
        <h3 class="card-title">检测报告</h3>
        <template v-if="inspections.length">
          <div v-for="report in inspections" :key="report.id" class="report-block">
            <div class="report-block__head">
              <span class="report-block__no">{{ report.reportNo }}</span>
              <AgriStatusTag :status="report.conclusion" :map="CONCLUSION_MAP" />
            </div>
            <dl class="info-list">
              <div class="info-row">
                <dt>检测机构</dt>
                <dd>{{ report.lab }}</dd>
              </div>
              <div class="info-row">
                <dt>检测项目</dt>
                <dd>{{ (report.inspectItems || []).length }} 项</dd>
              </div>
              <div class="info-row">
                <dt>报告日期</dt>
                <dd>{{ report.inspectedAt }}</dd>
              </div>
              <div class="info-row">
                <dt>结论</dt>
                <dd>{{ report.conclusionName }}</dd>
              </div>
            </dl>
            <el-button link type="primary" class="report-toggle" @click="toggleReport(report.id)">
              {{ expandedReports.includes(report.id) ? '收起详情' : '查看详情' }}
            </el-button>
            <div v-if="expandedReports.includes(report.id)" class="report-detail">
              <div class="report-detail__row report-detail__row--head">
                <span>项目</span>
                <span>结果</span>
                <span>限值</span>
                <span>判定</span>
              </div>
              <div
                v-for="detail in report.inspectItems || []"
                :key="detail.name"
                class="report-detail__row"
              >
                <span>{{ detail.name }}</span>
                <span>{{ detail.value }} {{ detail.unit }}</span>
                <span>≤ {{ detail.limit }} {{ detail.unit }}</span>
                <span :class="detail.result === '合格' ? 'is-pass' : 'is-fail'">
                  {{ detail.result }}
                </span>
              </div>
            </div>
          </div>
        </template>
        <AgriEmpty v-else description="暂无检测报告" height="130px" />
      </section>

      <section class="trace-card">
        <h3 class="card-title">企业与溯源说明</h3>
        <dl class="info-list">
          <div class="info-row">
            <dt>企业名称</dt>
            <dd>{{ company?.name || '-' }}</dd>
          </div>
          <div class="info-row">
            <dt>统一社会信用代码</dt>
            <dd>{{ maskCreditCode(company?.creditCode) }}</dd>
          </div>
        </dl>
        <p class="trace-desc">{{ traceChain }}</p>
      </section>
    </div>

    <div v-else class="trace-card state-card">
      <AgriEmpty description="输入溯源码开始查询" height="150px" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.m-scan {
  padding-bottom: 24px;
}

.scan-panel {
  padding: 16px 12px;
  margin-bottom: 12px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.scan-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 140px;
  color: $primary-color;
  border: 2px dashed $primary-light;
  border-radius: $radius-md;
  background-color: $primary-lighter;
}

.scan-frame__icon {
  width: 48px;
  height: 48px;
}

.scan-frame__text {
  font-size: 13px;
  color: $text-regular;
}

.scan-btn {
  width: 100%;
  height: 46px;
  margin: 12px 0 8px;
  font-size: 15px;
}

.scan-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.scan-input :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.scan-input :deep(.el-input__wrapper) {
  min-height: 44px;
}

.scan-input__btn {
  flex-shrink: 0;
  width: 76px;
  height: 44px;
}

.result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trace-card {
  padding: 14px 12px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.recall-banner {
  padding: 12px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #fff;
  text-align: center;
  background-color: $danger-color;
  border-radius: $radius-md;
}

.batch-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.batch-card__main {
  min-width: 0;
}

.batch-card__name {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: $text-primary;
}

.batch-card__no {
  margin-top: 4px;
  font-size: 13px;
  color: $text-secondary;
}

.batch-card__code {
  margin-top: 10px;
  padding: 8px 10px;
  font-size: 14px;
  font-weight: 600;
  color: $primary-color;
  word-break: break-all;
  background-color: $primary-lighter;
  border-radius: $radius-sm;
}

.batch-card__meta {
  margin-top: 8px;
  font-size: 13px;
  color: $text-secondary;
}

.card-title {
  margin-bottom: 10px;
  padding-left: 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: $text-primary;
  border-left: 3px solid $primary-color;
}

.info-list {
  margin: 0;
}

.info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
  line-height: 1.5;
}

.info-row dt {
  flex-shrink: 0;
  width: 92px;
  color: $text-secondary;
}

.info-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: $text-primary;
  word-break: break-all;
}

.trace-timeline {
  padding-left: 2px;
  margin: 0;
}

.trace-timeline :deep(.el-timeline-item__timestamp) {
  font-size: 13px;
}

.trace-timeline :deep(.el-timeline-item__content) {
  word-break: break-word;
}

.timeline__title {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
}

.timeline__desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.5;
  color: $text-regular;
}

.timeline__operator {
  margin-top: 2px;
  font-size: 13px;
  color: $text-secondary;
}

.report-block + .report-block {
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid $border-color;
}

.report-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.report-block__no {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  word-break: break-all;
}

.report-toggle {
  min-height: 44px;
  padding: 0;
  font-size: 13px;
}

.report-detail {
  padding: 6px 8px;
  background-color: $bg-page;
  border-radius: $radius-sm;
}

.report-detail__row {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr 0.7fr;
  gap: 4px;
  align-items: center;
  padding: 6px 0;
  font-size: 13px;
  line-height: 1.4;
  color: $text-regular;
  border-bottom: 1px dashed $border-color;
}

.report-detail__row:last-child {
  border-bottom: none;
}

.report-detail__row--head {
  font-weight: 600;
  color: $text-secondary;
}

.report-detail__row span {
  min-width: 0;
  word-break: break-word;
}

.is-pass {
  color: $success-color;
}

.is-fail {
  font-weight: 600;
  color: $danger-color;
}

.trace-desc {
  margin-top: 10px;
  padding-top: 10px;
  font-size: 13px;
  line-height: 1.6;
  color: $text-secondary;
  border-top: 1px dashed $border-color;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.state-card :deep(.el-button) {
  min-height: 44px;
}

.state-card__text {
  font-size: 14px;
  color: $danger-color;
}
</style>
