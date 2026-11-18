<script setup>
/**
 * M002 农事打卡上传
 * 数据来源：A11 工单（GET /farm/tasks）、A12 打卡记录（GET /farm/records）。
 * 数据缺口与兜底：
 * - A12 写入接口只接收 { taskId, content, photos, location }，没有打卡类型与备注字段，
 *   这里仍按业务完整表单提交（checkinType/remark），mock 侧暂时忽略，接口扩展后可直接落库；
 * - A12 列表不返回打卡类型与审核状态，打卡类型按 `${taskNo}|${checkedAt}` 缓存在 sessionStorage，
 *   审核状态统一展示为「待审核」（新提交记录必然处于待审核）；
 * - A11 不返回服务端当前时间，今日工单按 mock 固定业务日期 2026-11-16 过滤。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'

import { createFarmRecord, fetchFarmRecords, fetchFarmTasks } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'

defineOptions({ name: 'MobileCheckinPage' })

// 与 mock 固定业务时间（2026-11-16 18:30:00）对齐的「今天」
const BUSINESS_TODAY = '2026-11-16'
// mock 定位常量
const LOCATION = { name: '南京市江宁区·1号温室', lng: '118.8392', lat: '31.9531' }
const MAX_PHOTOS = 3
const LOCAL_TYPE_KEY = 'agri-m-checkin-type-v1'

// 打卡类型（接口暂无该字段，仅前端表单与本地展示使用）
const CHECKIN_TYPE_MAP = {
  ATTENDANCE: { text: '出勤打卡', type: 'primary' },
  AFTER_WORK: { text: '作业完成打卡', type: 'success' }
}

// A12 无审核状态字段，新提交记录统一按「待审核」展示
const RECORD_STATUS_MAP = {
  PENDING: { text: '待审核', type: 'warning' }
}

// CDP 环境无法调起文件选择器时使用：内置 SVG 占位图，不引入依赖
const SAMPLE_PHOTO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
    <rect width="240" height="240" fill="#e8f5e9"/>
    <circle cx="120" cy="66" r="26" fill="#66bb6a"/>
    <rect x="24" y="96" width="192" height="108" rx="10" fill="#a5d6a7"/>
    <path d="M120 40v52M94 66h52" stroke="#2e7d58" stroke-width="6"/>
    <text x="120" y="146" font-size="20" text-anchor="middle" fill="#1b5e20">示例照片</text>
    <text x="120" y="176" font-size="14" text-anchor="middle" fill="#2e7d58">1号温室 · 现场</text>
  </svg>`
)}`

const route = useRoute()

const formRef = ref(null)
const photoList = ref([])
const tasks = ref([])
const records = ref([])
const loadingTasks = ref(false)
const submitting = ref(false)
const locating = ref(false)
const loadError = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const presetApplied = ref(false)

const localTypes = ref(readLocalTypes())

const form = reactive({
  taskId: null,
  checkinType: '',
  content: '',
  photos: [],
  remark: ''
})

/** 读取本地打卡类型缓存（sessionStorage 不可用时静默降级） */
function readLocalTypes() {
  try {
    return JSON.parse(window.sessionStorage.getItem(LOCAL_TYPE_KEY) || '{}')
  } catch {
    return {}
  }
}

/** 今日工单：按 plannedAt 日期过滤 */
const todayTasks = computed(() =>
  tasks.value
    .filter((task) => String(task.plannedAt).slice(0, 10) === BUSINESS_TODAY)
    .sort((left, right) => String(right.plannedAt).localeCompare(String(left.plannedAt)))
)

// 选中工单后自动带出地块与任务名
const selectedTask = computed(
  () => todayTasks.value.find((task) => task.id === form.taskId) || null
)

// 最近 5 条打卡记录（A12 已按 checkedAt 倒序）
const recentRecords = computed(() => records.value.slice(0, 5))

/** 照片校验：至少 1 张 */
function validatePhotos(_rule, _value, callback) {
  if (!photoList.value.length) {
    callback(new Error('请至少上传 1 张现场照片'))
    return
  }
  callback()
}

const rules = {
  taskId: [{ required: true, message: '请选择关联工单', trigger: 'change' }],
  checkinType: [{ required: true, message: '请选择打卡类型', trigger: 'change' }],
  content: [{ required: true, message: '请填写作业内容', trigger: 'blur' }],
  photos: [{ validator: validatePhotos, trigger: 'change' }]
}

/** 记录标识：工单号 + 打卡时间 */
function recordKey(record) {
  return `${record.taskNo || ''}|${record.checkedAt || ''}`
}

/** 缓存本次打卡类型，供「最近打卡」列表展示 */
function saveLocalType(record, type) {
  if (!record || !type) {
    return
  }
  localTypes.value = { ...localTypes.value, [recordKey(record)]: type }
  try {
    window.sessionStorage.setItem(LOCAL_TYPE_KEY, JSON.stringify(localTypes.value))
  } catch {
    // 隐私模式或存储已满时忽略，不影响打卡结果
  }
}

/** 列表展示用的打卡类型 */
function displayType(record) {
  const type = localTypes.value[recordKey(record)]
  return CHECKIN_TYPE_MAP[type]?.text || '农事作业'
}

/** 拉取工单与打卡记录，写操作后同样走这里回源 */
async function loadAll() {
  loadingTasks.value = true
  loadError.value = false
  try {
    const [taskPage, recordPage] = await Promise.all([
      fetchFarmTasks({ page: 1, size: 100 }),
      fetchFarmRecords({ page: 1, size: 100 })
    ])
    tasks.value = taskPage.list || []
    records.value = recordPage.list || []
    applyPresetTask()
  } catch {
    // 拦截器已统一提示，这里只切换页面错误态
    loadError.value = true
  } finally {
    loadingTasks.value = false
  }
}

/** 从 route.query.taskId 预选工单（只执行一次，避免表单重置后又被选中） */
function applyPresetTask() {
  if (presetApplied.value) {
    return
  }
  presetApplied.value = true
  const rawTaskId = route.query.taskId
  if (!rawTaskId) {
    return
  }
  const target = todayTasks.value.find((task) => String(task.id) === String(rawTaskId))
  if (target && target.status !== 'CANCELLED') {
    form.taskId = target.id
  }
}

/** 切换工单后清掉旧校验提示 */
function handleTaskChange() {
  formRef.value?.clearValidate('taskId')
}

/**
 * 选择文件：auto-upload=false，仅本地预览。
 * Element Plus 在 picture-card 下会自动创建对象 URL，这里补一次兜底。
 */
function handlePhotoChange(uploadFile, uploadFiles) {
  if (uploadFile.raw && !uploadFile.url) {
    try {
      uploadFile.url = URL.createObjectURL(uploadFile.raw)
    } catch {
      // 极少数环境无法创建对象 URL，保留原有展示
    }
  }
  syncPhotos(uploadFiles)
}

/** 移除文件后同步表单字段 */
function handlePhotoRemove(_uploadFile, uploadFiles) {
  syncPhotos(uploadFiles)
}

/** 同步照片文件名到表单并清掉校验错误 */
function syncPhotos(list) {
  const files = list || photoList.value
  form.photos = files.map((file) => file.name)
  if (files.length) {
    formRef.value?.clearValidate('photos')
  }
}

/** 超出 3 张时的提示 */
function handleExceed() {
  ElMessage.warning(`现场照片最多上传 ${MAX_PHOTOS} 张`)
}

/** 点缩略图预览 */
function handlePreview(uploadFile) {
  previewUrl.value = uploadFile.url || SAMPLE_PHOTO
  previewVisible.value = true
}

/** 插入内置示例照片（CDP 环境无法选文件时使用） */
function addSamplePhoto() {
  if (photoList.value.length >= MAX_PHOTOS) {
    ElMessage.warning(`现场照片最多上传 ${MAX_PHOTOS} 张`)
    return
  }
  photoList.value = [
    ...photoList.value,
    {
      name: `示例照片-${photoList.value.length + 1}.svg`,
      url: SAMPLE_PHOTO,
      uid: `sample-${Date.now()}`,
      status: 'success'
    }
  ]
  syncPhotos()
}

let locateTimer = null

/** 重新定位：1 秒内返回 mock 常量坐标并提示 */
function relocate() {
  if (locating.value) {
    return
  }
  locating.value = true
  locateTimer = window.setTimeout(() => {
    locating.value = false
    ElMessage.success(`定位成功：${LOCATION.name}（${LOCATION.lng}, ${LOCATION.lat}）`)
  }, 1000)
}

/** 提交打卡：校验 → A12 → 重置表单 → 回源刷新最近打卡 */
async function handleSubmit() {
  if (submitting.value || !formRef.value) {
    return
  }
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    const payload = {
      taskId: form.taskId,
      content: form.content.trim(),
      photos: photoList.value.map((file) => file.name),
      location: `${LOCATION.name}（${LOCATION.lng}, ${LOCATION.lat}）`,
      // 以下两个字段 A12 handler 目前未接收，仅保留提交意图，接口扩展后可直接落库
      checkinType: form.checkinType,
      remark: form.remark.trim()
    }
    const created = await createFarmRecord(payload)
    // A12 不返回打卡类型，用本地缓存补上列表展示
    if (created && typeof created === 'object') {
      saveLocalType(created, form.checkinType)
    }
    ElMessage.success('打卡成功，已提交审核')
    formRef.value.resetFields()
    photoList.value = []
    await loadAll()
  } catch {
    // 拦截器已提示，保留表单内容供用户重试
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadAll()
})

onBeforeUnmount(() => {
  if (locateTimer) {
    window.clearTimeout(locateTimer)
    locateTimer = null
  }
})
</script>

<template>
  <div class="m-page m-checkin">
    <AgriPageHeader
      page-id="M002"
      title="农事打卡上传"
      description="拍照留存作业现场，提交后进入审核"
    />

    <div v-if="loadError" class="load-error">
      <p class="load-error__text">工单与打卡记录加载失败</p>
      <el-button type="primary" plain @click="loadAll">重新加载</el-button>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      class="checkin-form"
      hide-required-asterisk
    >
      <el-form-item label="关联工单" prop="taskId">
        <el-select
          v-model="form.taskId"
          class="field-full"
          size="large"
          placeholder="请选择今日工单"
          :loading="loadingTasks"
          @change="handleTaskChange"
        >
          <el-option
            v-for="task in todayTasks"
            :key="task.id"
            :label="`${task.plotName} · ${task.title}`"
            :value="task.id"
            :disabled="task.status === 'CANCELLED'"
          />
        </el-select>
        <p v-if="selectedTask" class="form-hint">
          地块：{{ selectedTask.plotName }}，任务：{{ selectedTask.title }}
        </p>
        <p v-else-if="!loadingTasks && !todayTasks.length" class="form-hint is-warn">
          今日暂无可打卡工单
        </p>
      </el-form-item>

      <el-form-item label="打卡类型" prop="checkinType">
        <div class="type-list">
          <el-radio v-model="form.checkinType" value="ATTENDANCE" border class="type-radio">
            出勤打卡
          </el-radio>
          <el-radio v-model="form.checkinType" value="AFTER_WORK" border class="type-radio">
            农事作业完成后打卡
          </el-radio>
        </div>
      </el-form-item>

      <el-form-item label="作业内容" prop="content">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="4"
          maxlength="200"
          show-word-limit
          placeholder="请描述本次农事作业内容，不超过 200 字"
        />
      </el-form-item>

      <el-form-item label="现场照片（最多 3 张）" prop="photos">
        <div class="photo-field">
          <el-upload
            v-model:file-list="photoList"
            list-type="picture-card"
            :auto-upload="false"
            :limit="MAX_PHOTOS"
            accept="image/*"
            :on-change="handlePhotoChange"
            :on-remove="handlePhotoRemove"
            :on-preview="handlePreview"
            :on-exceed="handleExceed"
          >
            <span class="upload-plus">+</span>
          </el-upload>
          <div class="photo-actions">
            <el-button plain class="photo-actions__btn" @click="addSamplePhoto">
              使用示例照片
            </el-button>
            <span class="photo-actions__tip">模拟上传，不会真正提交文件</span>
          </div>
        </div>
      </el-form-item>

      <el-form-item label="定位">
        <div class="location-card">
          <div class="location-card__main">
            <span class="location-card__name">{{ LOCATION.name }}</span>
            <span class="location-card__coord">{{ LOCATION.lng }}, {{ LOCATION.lat }}</span>
          </div>
          <el-button class="relocate-btn" :loading="locating" @click="relocate">重新定位</el-button>
        </div>
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="form.remark" maxlength="50" placeholder="选填，补充说明" />
      </el-form-item>

      <el-button type="primary" class="submit-btn" :loading="submitting" @click="handleSubmit">
        提交打卡
      </el-button>
    </el-form>

    <section class="recent">
      <div class="recent__head">
        <h3 class="recent__title">最近打卡</h3>
        <span class="recent__extra">最新 {{ recentRecords.length }} 条</span>
      </div>
      <div class="recent__card">
        <ul v-if="recentRecords.length" class="recent-list">
          <li v-for="record in recentRecords" :key="record.id" class="recent-item">
            <div class="recent-item__head">
              <span class="recent-item__task">{{ record.taskNo }}</span>
              <AgriStatusTag status="PENDING" :map="RECORD_STATUS_MAP" />
            </div>
            <p class="recent-item__meta">{{ record.checkedAt }}</p>
            <p class="recent-item__meta">
              {{ record.plotName }} · {{ displayType(record) }} ·
              {{ (record.photos || []).length }} 张照片
            </p>
            <p class="recent-item__content">{{ record.content }}</p>
          </li>
        </ul>
        <AgriEmpty v-else description="今日还没有打卡记录" height="140px" />
      </div>
    </section>

    <el-dialog v-model="previewVisible" title="照片预览" width="86%" align-center>
      <img :src="previewUrl" class="preview-img" alt="现场照片预览" />
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.m-checkin {
  padding-bottom: 24px;
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

.checkin-form {
  padding: 14px 12px 16px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.checkin-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.checkin-form :deep(.el-form-item__label) {
  padding-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: $text-primary;
}

.checkin-form :deep(.el-form-item__error) {
  padding-top: 4px;
  font-size: 13px;
}

.checkin-form :deep(.el-select),
.checkin-form :deep(.el-input) {
  width: 100%;
}

.checkin-form :deep(.el-select__wrapper),
.checkin-form :deep(.el-input__wrapper) {
  min-height: 44px;
}

.checkin-form :deep(.el-textarea__inner) {
  font-size: 14px;
}

.field-full {
  width: 100%;
}

.form-hint {
  width: 100%;
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
  color: $text-secondary;
}

.form-hint.is-warn {
  color: $warning-color;
}

.type-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.type-radio {
  width: 100%;
  height: 44px;
  margin-right: 0;
}

.photo-field {
  width: 100%;
}

.photo-field :deep(.el-upload--picture-card),
.photo-field :deep(.el-upload-list--picture-card .el-upload-list__item) {
  width: 92px;
  height: 92px;
  border-radius: $radius-sm;
}

.photo-field :deep(.el-upload-list--picture-card) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.photo-field :deep(.el-upload-list--picture-card .el-upload-list__item) {
  margin: 0;
}

.upload-plus {
  font-size: 24px;
  line-height: 1;
  color: $text-secondary;
}

.photo-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.photo-actions__btn {
  min-height: 44px;
}

.photo-actions__tip {
  font-size: 13px;
  color: $text-secondary;
}

.location-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background-color: $bg-page;
  border-radius: $radius-sm;
}

.location-card__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.location-card__name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relocate-btn {
  flex-shrink: 0;
  min-height: 44px;
}

.location-card__coord {
  font-size: 13px;
  color: $text-secondary;
}

.submit-btn {
  width: 100%;
  height: 48px;
  margin-top: 4px;
  font-size: 16px;
}

.recent {
  margin-top: 16px;
}

.recent__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.recent__title {
  font-size: 15px;
  font-weight: 600;
  color: $text-primary;
}

.recent__extra {
  font-size: 13px;
  color: $text-secondary;
}

.recent__card {
  padding: 0 12px;
  background-color: $bg-card;
  border-radius: $radius-md;
  box-shadow: $shadow-sm;
}

.recent-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-item {
  padding: 12px 0;
  border-bottom: 1px solid $border-color;
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.recent-item__task {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__meta {
  margin-top: 4px;
  overflow: hidden;
  font-size: 13px;
  color: $text-secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__content {
  display: -webkit-box;
  margin-top: 4px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
  color: $text-regular;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preview-img {
  display: block;
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
}
</style>
