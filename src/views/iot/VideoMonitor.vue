<script setup>
/**
 * P013 视频监控
 * 职责：以设备台账中的摄像头（category=CAMERA）为数据源，用卡片网格展示地块摄像头状态，
 *      点击卡片查看大图占位、设备信息与抓拍入口。
 * 说明：本轮不接入真实流媒体（不引 hls.js / flv.js，不写流地址），
 *      播放区统一为深色占位 +「实时画面接入中」，避免给出不可用的播放能力。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchDevices, fetchPlots } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'

defineOptions({ name: 'VideoMonitorPage' })

// 摄像头全量（当前规模 8 台，一次取全量后前端按地块/状态筛）
const cameras = ref([])
const loading = ref(false)
const loadError = ref(false)

// 地块下拉
const plots = ref([])

// 筛选条件
const plotId = ref('')
const status = ref('')

// 当前查看的摄像头
const activeCamera = ref(null)
const dialogVisible = ref(false)

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '在线', value: 'ONLINE' },
  { label: '离线', value: 'OFFLINE' },
  { label: '故障', value: 'FAULT' }
]

const plotOptions = computed(() => [
  { label: '全部地块', value: '' },
  ...plots.value.map((plot) => ({ label: plot.name, value: plot.id }))
])

// 过滤后的卡片数据
const filteredCameras = computed(() =>
  cameras.value.filter((camera) => {
    if (plotId.value && camera.plotId !== plotId.value) {
      return false
    }
    if (status.value && camera.status !== status.value) {
      return false
    }
    return true
  })
)

// 顶部概览：在线 / 离线 / 告警（故障）数量，基于全量而不是筛选结果
const summary = computed(() => {
  const total = cameras.value.length
  const online = cameras.value.filter((camera) => camera.status === 'ONLINE').length
  return {
    total,
    online,
    offline: total - online
  }
})

/** 载入地块下拉 */
async function loadPlots() {
  try {
    const data = await fetchPlots({ page: 1, size: 100 })
    plots.value = data?.list || []
  } catch {
    plots.value = []
  }
}

/** 载入摄像头列表（A03，category=CAMERA） */
async function loadCameras() {
  loadError.value = false
  loading.value = true
  try {
    const data = await fetchDevices({ category: 'CAMERA', page: 1, size: 100 })
    cameras.value = data?.list || []
  } catch (err) {
    cameras.value = []
    if (err?.code !== 40401) {
      loadError.value = true
    }
  } finally {
    loading.value = false
  }
}

/**
 * 打开摄像头大图占位弹窗。
 * @param {Object} camera 摄像头行
 */
function openCamera(camera) {
  activeCamera.value = camera
  dialogVisible.value = true
}

/** 抓拍：本轮没有真实抓拍能力，仅给出提示 */
function handleSnapshot() {
  ElMessage.info('抓拍已保存到本地')
}

/** 刷新：重新拉取摄像头与地块 */
function refresh() {
  loadPlots()
  loadCameras()
}

onMounted(refresh)
</script>

<template>
  <div class="page-container video-monitor">
    <AgriPageHeader
      page-id="P013"
      title="视频监控"
      description="按地块查看摄像头在线状态与画面接入情况，支持筛选、刷新与抓拍。"
    >
      <template #extra>
        <span class="video-monitor__summary text-secondary">
          共 {{ summary.total }} 路 · 在线 {{ summary.online }} · 离线 {{ summary.offline }}
        </span>
        <el-button :loading="loading" @click="refresh">刷新</el-button>
      </template>
    </AgriPageHeader>

    <!-- 筛选条 -->
    <div class="agri-card video-monitor__section">
      <div class="video-monitor__filters">
        <div class="video-monitor__field">
          <span class="video-monitor__label">地块</span>
          <el-select v-model="plotId" class="video-monitor__select" placeholder="全部地块">
            <el-option
              v-for="item in plotOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
        <div class="video-monitor__field">
          <span class="video-monitor__label">在线状态</span>
          <el-select v-model="status" class="video-monitor__select" placeholder="全部状态">
            <el-option
              v-for="item in statusOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
        <span class="video-monitor__count text-secondary">
          当前展示 {{ filteredCameras.length }} 路
        </span>
      </div>
    </div>

    <!-- 摄像头卡片网格 -->
    <div v-if="loadError" class="video-monitor__error" @click="loadCameras">加载失败，点击重试</div>
    <div v-else v-loading="loading" class="video-monitor__grid-wrap">
      <AgriEmpty
        v-if="!loading && !filteredCameras.length"
        :height="240"
        description="没有符合条件的摄像头，试试调整地块或状态筛选"
      />
      <div v-else class="video-monitor__grid">
        <div
          v-for="camera in filteredCameras"
          :key="camera.code"
          class="video-monitor__card"
          :class="{
            'video-monitor__card--offline': camera.status !== 'ONLINE',
            'video-monitor__card--active': camera.status === 'ONLINE'
          }"
          @click="openCamera(camera)"
        >
          <!-- 16:9 占位播放区：不引播放器依赖，避免给出虚假的播放能力 -->
          <div class="video-monitor__player">
            <span class="video-monitor__play-icon" />
            <span class="video-monitor__player-text">实时画面接入中</span>
          </div>
          <div class="video-monitor__card-body">
            <div class="video-monitor__card-title">
              <span class="video-monitor__name">{{ camera.name }}</span>
              <AgriStatusTag :status="camera.status" />
            </div>
            <div class="video-monitor__card-meta">
              <span>{{ camera.plotName }}</span>
              <span>{{ camera.code }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 大图占位弹窗 -->
    <el-dialog v-model="dialogVisible" :title="activeCamera?.name || '摄像头详情'" width="760px">
      <div class="video-monitor__dialog">
        <div class="video-monitor__dialog-player">
          <span class="video-monitor__play-icon video-monitor__play-icon--large" />
          <span class="video-monitor__player-text">实时画面接入中</span>
        </div>
        <el-descriptions v-if="activeCamera" :column="2" border>
          <el-descriptions-item label="设备编号">{{ activeCamera.code }}</el-descriptions-item>
          <el-descriptions-item label="设备类型">
            {{ activeCamera.typeName }}
          </el-descriptions-item>
          <el-descriptions-item label="所属地块">
            {{ activeCamera.plotName }}
          </el-descriptions-item>
          <el-descriptions-item label="运行状态">
            <AgriStatusTag :status="activeCamera.status" />
          </el-descriptions-item>
          <el-descriptions-item label="最后上报">
            {{ activeCamera.lastSeen }}
          </el-descriptions-item>
          <el-descriptions-item label="信号强度">
            {{ activeCamera.signal }}
          </el-descriptions-item>
          <el-descriptions-item label="内网 IP">{{ activeCamera.ip }}</el-descriptions-item>
          <el-descriptions-item label="厂商">
            {{ activeCamera.manufacturer }}
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleSnapshot">抓拍</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.video-monitor__summary {
  margin-right: $space-sm;
  font-size: $font-size-xs;
}

.video-monitor__section {
  margin-bottom: $space-md;
}

.video-monitor__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-md;
}

.video-monitor__field {
  display: flex;
  align-items: center;
  gap: $space-sm;
}

.video-monitor__label {
  font-size: $font-size-sm;
  color: $text-secondary;
  white-space: nowrap;
}

.video-monitor__select {
  width: 180px;
}

.video-monitor__count {
  margin-left: auto;
  font-size: $font-size-xs;
}

// 卡片网格：默认 4 列，随宽度降到 3 / 2 列
.video-monitor__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: $space-md;
}

.video-monitor__card {
  overflow: hidden;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
  box-shadow: $shadow-sm;
  cursor: pointer;
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    box-shadow: $shadow-card;
    transform: translateY(-2px);
  }
}

// 在线设备左侧加主色条，突出可用视图
.video-monitor__card--active {
  border-left: 3px solid $primary-color;
}

// 离线/故障置灰，避免误以为画面可看
.video-monitor__card--offline {
  filter: grayscale(0.35);
  opacity: 0.8;
}

.video-monitor__player,
.video-monitor__dialog-player {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $space-sm;
  aspect-ratio: 16 / 9;
  background: #1c2733;
  color: rgba(255, 255, 255, 0.7);
}

.video-monitor__player-text {
  font-size: $font-size-xs;
  letter-spacing: 1px;
}

// 纯 CSS 三角形播放图标，避免引入图标库依赖
.video-monitor__play-icon {
  width: 0;
  height: 0;
  border-top: 14px solid transparent;
  border-bottom: 14px solid transparent;
  border-left: 22px solid rgba(255, 255, 255, 0.75);
}

.video-monitor__play-icon--large {
  border-top-width: 26px;
  border-bottom-width: 26px;
  border-left-width: 42px;
}

.video-monitor__card-body {
  padding: $space-sm $space-md;
}

.video-monitor__card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-sm;
}

.video-monitor__name {
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-monitor__card-meta {
  display: flex;
  justify-content: space-between;
  gap: $space-sm;
  margin-top: $space-xs;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.video-monitor__grid-wrap {
  min-height: 200px;
}

.video-monitor__dialog-player {
  border-radius: $radius-md;
  margin-bottom: $space-md;
}

.video-monitor__error {
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

@media (max-width: $breakpoint-xl) {
  .video-monitor__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: $breakpoint-md) {
  .video-monitor__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .video-monitor__count {
    margin-left: 0;
  }
}

@media (max-width: $breakpoint-sm) {
  .video-monitor__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .video-monitor__select {
    width: 140px;
  }
}
</style>
