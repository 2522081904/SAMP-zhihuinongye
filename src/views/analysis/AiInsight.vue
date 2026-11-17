<script setup>
/**
 * P012 长势与病虫害识别
 * 数据来源：A21 AI 诊断（列表 + 发起诊断）、A14 用药记录（建议用药参考）。
 * 说明：
 * - A21 的结论是自然语言，没有结构化的“病害名”字段，页面按关键词字典从结论中提取；
 * - 防治建议由 advice 按标点拆分成分条列表；
 * - 内置 3 张 SVG 示意图（data URL）供无本地图片时直接体验，历史缩略图同样用内联 SVG，
 *   不请求外网图片（A21 返回的 imageUrl 指向不可达的示例域名）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { createDiagnosis, fetchDiagnoses, fetchPesticideLogs, fetchPlots } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'AnalysisAiInsightPage' })

// 识别类型
const TYPE_OPTIONS = [
  { label: '长势分析', value: 'GROWTH' },
  { label: '虫害识别', value: 'PEST' },
  { label: '病害识别', value: 'DISEASE' }
]

// 病害关键词字典（用于从结论文本中提取疑似病害名）
const DISEASE_TERMS = [
  '早疫病',
  '晚疫病',
  '叶斑病',
  '白粉病',
  '灰霉病',
  '霜霉病',
  '枯萎病',
  '炭疽病'
]

// 虫害关键词字典
const PEST_TERMS = ['蚜虫', '白粉虱', '红蜘蛛', '蓟马', '斑潜蝇', '棉铃虫']

// 长势关键词字典
const GROWTH_TERMS = ['长势良好', '叶面积指数', '缺素']

// 上传限制
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png']

// 历史记录每页条数
const HISTORY_SIZE = 5

const loading = ref(false)
const error = ref(false)
const recognizing = ref(false)
const plotOptions = ref([])

// 诊断表单
const form = reactive({ plotId: '', diagnosisType: 'DISEASE' })

// 图像状态：上传的本地图片优先，其次内置示意图
const previewUrl = ref('')
const previewName = ref('')
const selectedSample = ref('')
// 历史记录
const historyList = ref([])
const historyTotal = ref(0)
const historyPage = ref(1)
const historySize = ref(HISTORY_SIZE)
const historyLoading = ref(false)
// 识别结果
const result = ref(null)
// 建议用药
const medicines = ref([])
// 历史详情抽屉
const drawerVisible = ref(false)
const detailRow = ref(null)

/**
 * 生成一张内联 SVG 示意图的 data URL。
 * @param {string} label 图上的说明文字
 * @param {string} tone 背景主色
 * @returns {string} data URL
 */
function buildSampleImage(label, tone) {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">',
    `<rect width="320" height="200" rx="8" fill="${tone}"/>`,
    '<path d="M20 150 Q80 110 140 150 T260 150" stroke="rgba(255,255,255,0.5)" fill="none" stroke-width="3"/>',
    '<circle cx="120" cy="98" r="26" fill="rgba(255,255,255,0.22)"/>',
    '<circle cx="196" cy="118" r="18" fill="rgba(255,255,255,0.18)"/>',
    `<text x="160" y="176" font-size="14" fill="#ffffff" font-family="sans-serif" text-anchor="middle">${label}</text>`,
    '</svg>'
  ].join('')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// 内置示意图：分别对应病害、虫害、长势三种诊断类型
const SAMPLES = [
  { key: 'disease', label: '番茄叶片样本', tone: '#3f6b52', type: 'DISEASE' },
  { key: 'pest', label: '黄瓜叶背样本', tone: '#5a6b3f', type: 'PEST' },
  { key: 'growth', label: '生菜长势样本', tone: '#37626b', type: 'GROWTH' }
].map((item) => ({ ...item, url: buildSampleImage(item.label, item.tone) }))

// 最终提交给 A21 的图像地址
const imageUrl = computed(() => previewUrl.value || selectedSample.value)

// 可选图像（用于展示当前选择）
const currentImageLabel = computed(() => {
  if (previewName.value) {
    return previewName.value
  }
  const sample = SAMPLES.find((item) => item.url === selectedSample.value)
  return sample?.label || ''
})

const columns = [
  { prop: 'createdAt', label: '识别时间', width: 170 },
  { prop: 'plotName', label: '地块', width: 150 },
  { prop: 'thumb', label: '图像', width: 100, slot: 'thumb' },
  { prop: 'conclusion', label: '识别结论', minWidth: 260, slot: 'conclusion' },
  { prop: 'confidence', label: '置信度', width: 160, slot: 'confidence' },
  { prop: 'actions', label: '操作', width: 90, slot: 'actions' }
]

/** 置信度百分比（保留 1 位小数） */
const confidencePercent = computed(() => {
  const value = Number(result.value?.confidence) || 0
  return Math.round(value * 1000) / 10
})

/** 从结论中提取的疑似病害/虫害名 */
const detectedTerms = computed(() => {
  const conclusion = String(result.value?.conclusion || '')
  if (!conclusion) {
    return []
  }
  const type = result.value?.diagnosisType
  const dictionary =
    type === 'DISEASE' ? DISEASE_TERMS : type === 'PEST' ? PEST_TERMS : GROWTH_TERMS
  const suffix = type === 'DISEASE' ? '病害' : type === 'PEST' ? '虫害' : '指标'
  return dictionary
    .filter((term) => conclusion.includes(term))
    .map((term) => ({ name: term, suffix }))
})

/** 防治建议：按标点拆分成分条 */
const adviceList = computed(() =>
  String(result.value?.advice || '')
    .split(/[，；。]/)
    .map((item) => item.trim())
    .filter(Boolean)
)

/** 识别结果里的作物与地块 */
const resultPlot = computed(() => {
  const plot = plotOptions.value.find((item) => item.value === form.plotId)
  return plot?.label || result.value?.plotName || '-'
})

/** 历史记录缩略图配色：按诊断类型区分 */
function thumbTone(type) {
  if (type === 'DISEASE') {
    return '#e8f3ec'
  }
  return type === 'PEST' ? '#fdf3e3' : '#e9f1f7'
}

/** 历史记录缩略图上的文字 */
function thumbText(row) {
  return row.diagnosisTypeName || '识别'
}

/** 时间串转毫秒（仅用于展示排序，不做业务时间推算） */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/** 延迟工具，用于让识别过程有可感知的过程 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 载入地块下拉 */
async function loadPlots() {
  try {
    const data = await fetchPlots({ page: 1, size: 50 })
    plotOptions.value = (data?.list || []).map((plot) => ({ label: plot.name, value: plot.id }))
    if (!form.plotId && plotOptions.value.length) {
      form.plotId = plotOptions.value[0].value
    }
  } catch {
    plotOptions.value = []
  }
}

/**
 * 载入历史识别记录。
 * @param {number} page 页码
 */
async function loadHistory(page = historyPage.value) {
  historyLoading.value = true
  try {
    const data = await fetchDiagnoses({ page, size: historySize.value })
    const list = data?.list || []
    // A21 按创建顺序返回，这里按时间倒序展示
    historyList.value = [...list].sort(
      (left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt)
    )
    historyTotal.value = data?.total || 0
    historyPage.value = page
  } catch (err) {
    if (err?.code !== 40401) {
      error.value = true
    }
  } finally {
    historyLoading.value = false
  }
}

/**
 * 载入该地块的用药记录，作为建议用药参考（A14）。
 * @param {string} plotId 地块 id
 */
async function loadMedicine(plotId) {
  try {
    const data = await fetchPesticideLogs({ page: 1, size: 100 })
    const rows = (data?.list || []).filter((item) => !plotId || item.plotId === plotId)
    medicines.value = rows.slice(0, 3)
  } catch {
    medicines.value = []
  }
}

/** 选择内置示意图 */
function pickSample(sample) {
  selectedSample.value = sample.url
  previewName.value = ''
  form.diagnosisType = sample.type
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

/**
 * 选择本地图片：校验类型与大小后生成本地预览。
 * @param {Object} uploadFile el-upload 的文件对象
 */
function handleFileChange(uploadFile) {
  const raw = uploadFile?.raw
  if (!raw) {
    return
  }
  if (!ALLOWED_TYPES.includes(raw.type)) {
    ElMessage.warning('仅支持 JPG / PNG 格式的图片')
    return
  }
  if (raw.size > MAX_FILE_SIZE) {
    ElMessage.warning('图片大小不能超过 5MB')
    return
  }
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = URL.createObjectURL(raw)
  previewName.value = raw.name
  selectedSample.value = ''
}

/** 开始识别：并发发起 A21 诊断与最短 loading 时长 */
async function startRecognize() {
  if (!form.plotId) {
    ElMessage.warning('请先选择地块')
    return
  }
  if (!imageUrl.value) {
    ElMessage.warning('请先选择或上传一张作物图像')
    return
  }
  recognizing.value = true
  try {
    const [created] = await Promise.all([
      createDiagnosis({
        plotId: form.plotId,
        diagnosisType: form.diagnosisType,
        imageUrl: imageUrl.value
      }),
      sleep(800)
    ])
    result.value = created
    await Promise.all([loadHistory(1), loadMedicine(form.plotId)])
    ElMessage.success('识别完成，已生成诊断记录')
  } catch (err) {
    if (err?.code !== 40401) {
      ElMessage.error(`识别失败：${err?.message || '请稍后重试'}`)
    }
  } finally {
    recognizing.value = false
  }
}

/** 分页：AgriTable 抛 { page, size } */
async function handlePageChange(payload) {
  historySize.value = payload.size
  await loadHistory(payload.page)
}

/** 查看历史记录详情 */
function openDetail(row) {
  detailRow.value = row
  drawerVisible.value = true
}

onMounted(async () => {
  loading.value = true
  error.value = false
  try {
    await Promise.all([loadPlots(), loadHistory(1)])
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page-container ai-page">
    <AgriPageHeader
      page-id="P012"
      title="长势与病虫害识别"
      description="上传作物图像或选用内置样本，调用 AI 诊断获取长势结论、病害识别与防治建议。"
    >
      <template #extra>
        <span class="ai-page__count">累计识别 {{ historyTotal }} 次</span>
      </template>
    </AgriPageHeader>

    <div v-if="error" class="ai-page__error" @click="loadHistory(1)">
      识别记录加载失败，点击重试
    </div>

    <div class="ai-page__layout">
      <section class="agri-card ai-page__panel">
        <h3 class="ai-page__panel-title">图像与识别设置</h3>
        <el-form label-width="88px">
          <el-form-item label="地块">
            <el-select v-model="form.plotId" class="ai-page__full" placeholder="请选择地块">
              <el-option
                v-for="item in plotOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="识别类型">
            <el-radio-group v-model="form.diagnosisType">
              <el-radio v-for="item in TYPE_OPTIONS" :key="item.value" :value="item.value">
                {{ item.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>

        <el-upload
          class="ai-page__upload"
          drag
          :auto-upload="false"
          :show-file-list="false"
          accept=".jpg,.jpeg,.png"
          :on-change="handleFileChange"
        >
          <div v-if="previewUrl" class="ai-page__preview">
            <img :src="previewUrl" alt="待识别图像预览" class="ai-page__preview-img" />
            <span class="ai-page__preview-name">{{ currentImageLabel }}</span>
          </div>
          <template v-else>
            <div class="ai-page__upload-tip">
              <p class="ai-page__upload-title">点击或拖拽图片到此处</p>
              <p class="ai-page__upload-desc">支持 JPG / PNG，单张不超过 5MB</p>
            </div>
          </template>
        </el-upload>

        <div class="ai-page__samples">
          <span class="ai-page__samples-label">内置示意图：</span>
          <button
            v-for="sample in SAMPLES"
            :key="sample.key"
            type="button"
            class="ai-page__sample"
            :class="{ 'ai-page__sample--active': selectedSample === sample.url }"
            @click="pickSample(sample)"
          >
            <img :src="sample.url" :alt="sample.label" class="ai-page__sample-img" />
            <span class="ai-page__sample-label">{{ sample.label }}</span>
          </button>
        </div>

        <div class="ai-page__actions">
          <el-button
            type="primary"
            :loading="recognizing"
            class="ai-page__submit"
            @click="startRecognize"
          >
            {{ recognizing ? '识别中…' : '开始识别' }}
          </el-button>
          <span v-if="currentImageLabel" class="ai-page__current"
            >当前图像：{{ currentImageLabel }}</span
          >
        </div>
      </section>

      <section class="agri-card ai-page__result-card">
        <h3 class="ai-page__panel-title">识别结果</h3>
        <template v-if="result">
          <div class="ai-page__result">
            <div class="ai-page__result-head">
              <el-tag type="success" effect="plain">{{ result.diagnosisTypeName }}</el-tag>
              <span class="ai-page__result-meta">
                {{ result.diagnosisNo }} · {{ resultPlot }} · {{ result.createdAt }}
              </span>
            </div>
            <p class="ai-page__result-conclusion">{{ result.conclusion }}</p>
            <div class="ai-page__confidence">
              <span class="ai-page__confidence-label">置信度</span>
              <el-progress
                :percentage="confidencePercent"
                :stroke-width="12"
                :color="confidencePercent >= 85 ? '#2e7d58' : '#e6a23c'"
                striped
                class="ai-page__confidence-bar"
              />
              <span class="ai-page__result-confidence">{{ confidencePercent }}%</span>
            </div>
            <div v-if="detectedTerms.length" class="ai-page__terms">
              <span class="ai-page__terms-label">疑似对象</span>
              <el-tag
                v-for="term in detectedTerms"
                :key="term.name"
                size="small"
                type="danger"
                effect="plain"
              >
                {{ term.name }} · {{ term.suffix }}
              </el-tag>
            </div>
            <div class="ai-page__advice">
              <span class="ai-page__terms-label">防治建议</span>
              <ol class="ai-page__advice-list">
                <li v-for="(item, index) in adviceList" :key="index">{{ item }}</li>
              </ol>
            </div>
            <div class="ai-page__medicine">
              <span class="ai-page__terms-label">建议用药参考</span>
              <el-table
                v-if="medicines.length"
                :data="medicines"
                size="small"
                border
                class="ai-page__medicine-table"
              >
                <el-table-column prop="pesticideName" label="药名" min-width="140" />
                <el-table-column prop="dilution" label="稀释倍数" width="110" />
                <el-table-column prop="safeIntervalDays" label="安全间隔期" width="110">
                  <template #default="{ row }">{{ row.safeIntervalDays }} 天</template>
                </el-table-column>
              </el-table>
              <p v-else class="ai-page__medicine-empty">
                该地块暂无用药记录（A14），请联系植保人员确认用药方案。
              </p>
            </div>
          </div>
        </template>
        <div v-else class="ai-page__result-empty">
          <p class="ai-page__result-empty-title">尚未发起识别</p>
          <p class="ai-page__result-empty-desc">
            在左侧选择地块与识别类型，选用内置示意图或上传图片后点击「开始识别」，
            结果将展示结论、置信度、防治建议与用药参考。
          </p>
        </div>
      </section>
    </div>

    <div class="agri-card ai-page__history">
      <div class="ai-page__history-head">
        <h3 class="ai-page__panel-title">历史识别记录</h3>
        <span class="ai-page__count">共 {{ historyTotal }} 条</span>
      </div>
      <AgriTable
        :columns="columns"
        :data="historyList"
        :loading="historyLoading"
        :total="historyTotal"
        :page="historyPage"
        :size="historySize"
        :page-sizes="[5, 10, 20]"
        row-key="id"
        empty-text="暂无识别记录，选择图像后点击「开始识别」生成第一条记录"
        @page-change="handlePageChange"
        @size-change="handlePageChange"
      >
        <template #thumb="{ row }">
          <span
            class="ai-page__thumb"
            :style="{ background: thumbTone(row.diagnosisType) }"
            :title="row.diagnosisTypeName"
          >
            {{ thumbText(row) }}
          </span>
        </template>
        <template #conclusion="{ row }">
          <span class="ai-page__conclusion">{{ row.conclusion }}</span>
        </template>
        <template #confidence="{ row }">
          <el-progress
            :percentage="Math.round((row.confidence || 0) * 1000) / 10"
            :stroke-width="8"
            :show-text="false"
            color="#2e7d58"
          />
          <span class="ai-page__confidence-text">
            {{ Math.round((row.confidence || 0) * 1000) / 10 }}%
          </span>
        </template>
        <template #actions="{ row }">
          <el-button link type="primary" @click="openDetail(row)">查看</el-button>
        </template>
      </AgriTable>
    </div>

    <el-drawer v-model="drawerVisible" title="识别记录详情" size="460px">
      <template v-if="detailRow">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="识别编号">{{ detailRow.diagnosisNo }}</el-descriptions-item>
          <el-descriptions-item label="识别时间">{{ detailRow.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="地块">{{ detailRow.plotName }}</el-descriptions-item>
          <el-descriptions-item label="作物">{{ detailRow.crop }}</el-descriptions-item>
          <el-descriptions-item label="识别类型">
            {{ detailRow.diagnosisTypeName }}
          </el-descriptions-item>
          <el-descriptions-item label="置信度">
            {{ Math.round((detailRow.confidence || 0) * 1000) / 10 }}%
          </el-descriptions-item>
          <el-descriptions-item label="识别结论">{{ detailRow.conclusion }}</el-descriptions-item>
          <el-descriptions-item label="防治建议">{{ detailRow.advice }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ detailRow.operator }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped lang="scss">
.ai-page__count {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__layout {
  display: grid;
  grid-template-columns: minmax(340px, 1fr) minmax(0, 1.15fr);
  gap: 16px;
  margin-bottom: 16px;
}

.ai-page__panel,
.ai-page__result-card {
  padding: 16px;
}

.ai-page__panel-title {
  margin: 0 0 12px;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.ai-page__full {
  width: 100%;
}

.ai-page__upload {
  margin-bottom: 12px;

  :deep(.el-upload) {
    width: 100%;
  }

  :deep(.el-upload-dragger) {
    width: 100%;
    padding: 16px;
  }
}

.ai-page__upload-tip {
  padding: 18px 0;
}

.ai-page__upload-title {
  margin: 0 0 6px;
  font-size: $font-size-sm;
  color: $text-primary;
}

.ai-page__upload-desc {
  margin: 0;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.ai-page__preview-img {
  max-width: 100%;
  max-height: 200px;
  border-radius: $radius-sm;
}

.ai-page__preview-name {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__samples {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.ai-page__samples-label {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__sample {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: $bg-card;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  cursor: pointer;
}

.ai-page__sample--active {
  border-color: $primary-color;
  box-shadow: 0 0 0 2px rgba(46, 125, 88, 0.14);
}

.ai-page__sample-img {
  width: 92px;
  height: 58px;
  border-radius: 2px;
  object-fit: cover;
}

.ai-page__sample-label {
  font-size: 11px;
  color: $text-secondary;
}

.ai-page__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-page__submit {
  min-width: 120px;
}

.ai-page__current {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__result-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ai-page__result-meta {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__result-conclusion {
  margin: 0 0 14px;
  font-size: $font-size-md;
  font-weight: 600;
  line-height: 1.7;
  color: $text-primary;
}

.ai-page__confidence {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.ai-page__confidence-label,
.ai-page__terms-label {
  flex: 0 0 auto;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__confidence-bar {
  flex: 1;
  min-width: 0;
}

.ai-page__result-confidence {
  flex: 0 0 auto;
  font-size: $font-size-md;
  font-weight: 600;
  color: $primary-color;
}

.ai-page__terms {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.ai-page__advice,
.ai-page__medicine {
  margin-bottom: 14px;
}

.ai-page__advice-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: $font-size-sm;
  line-height: 1.9;
  color: $text-primary;
}

.ai-page__medicine-table {
  margin-top: 8px;
}

.ai-page__medicine-empty {
  margin: 8px 0 0;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__result-empty {
  padding: 32px 8px;
  text-align: center;
}

.ai-page__result-empty-title {
  margin: 0 0 8px;
  font-size: $font-size-sm;
  color: $text-primary;
}

.ai-page__result-empty-desc {
  margin: 0;
  font-size: $font-size-xs;
  line-height: 1.8;
  color: $text-secondary;
}

.ai-page__history {
  padding: 16px;
}

.ai-page__history-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.ai-page__thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 68px;
  height: 34px;
  font-size: 11px;
  color: $text-secondary;
  border-radius: $radius-sm;
}

.ai-page__conclusion {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.6;
}

.ai-page__confidence-text {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.ai-page__error {
  margin-bottom: 16px;
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}

@media (max-width: 1280px) {
  .ai-page__layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
