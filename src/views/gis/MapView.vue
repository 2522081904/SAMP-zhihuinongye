<script setup>
/**
 * P014 GIS 地图总览与地块绘制
 * 职责：用 SVG 绘制地块平面图（真实 A10 边界经纬度投影）；叠加设备点位（A03）、
 *      告警点位（A19）与灌溉管线；支持图层开关、地块选中与在地图上绘制新地块。
 * 说明：项目未引入地图库，投影按等距圆柱（经度乘纬度余弦）实现，
 *      绘制面积为像素鞋带公式 × 每像素米数² 换算为亩，与 A10 的边界面积口径一致。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { fetchAlarms, fetchDevices, fetchPlots } from '@/api'
import AgriEmpty from '@/components/AgriEmpty.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'GisMapViewPage' })

// 画布尺寸与内边距
const VIEW_W = 1000
const VIEW_H = 600
const PADDING = 46
// 亩与平方米换算
const SQUARE_METERS_PER_MU = 666.6667
// 每度纬度对应的米数
const METERS_PER_DEGREE = 111320

const plots = ref([])
const devices = ref([])
const alarms = ref([])
const loading = ref(false)
const error = ref(false)

// 图层开关
const visibleLayers = ref(['boundary', 'devices', 'alarms', 'pipeline'])
const LAYER_ITEMS = [
  { value: 'boundary', label: '地块边界' },
  { value: 'devices', label: '设备点位' },
  { value: 'alarms', label: '告警点位' },
  { value: 'pipeline', label: '灌溉管线' }
]

const selectedId = ref('')
// 本地绘制的地块：仅内存，不落库
const localPlots = ref([])

// 绘制模式
const drawing = ref(false)
const draftPoints = ref([])
const svgRef = ref(null)
const drawDialogVisible = ref(false)
const drawFormRef = ref(null)
const drawForm = reactive({ name: '', crop: '番茄', manager: '' })
const drawRules = {
  name: [{ required: true, message: '请填写地块名称', trigger: 'blur' }],
  crop: [{ required: true, message: '请选择作物', trigger: 'change' }]
}
const CROP_OPTIONS = ['番茄', '黄瓜', '生菜', '草莓', '水稻', '小麦', '玉米', '大豆', '其他']

// 双指/双击落点去抖：用单调时钟记录最后一次落点时间（仅交互计时，不作为业务时间）
let lastPointAt = 0

const columns = [
  { prop: 'name', label: '地块名称', minWidth: 180 },
  { prop: 'areaMu', label: '面积（亩）', width: 120, slot: 'area' },
  { prop: 'crop', label: '作物', width: 110 },
  { prop: 'deviceCount', label: '设备数', width: 100, slot: 'deviceCount' },
  { prop: 'actions', label: '操作', width: 100, slot: 'actions' }
]

/**
 * 经纬度 → 画布坐标的投影。
 * 先按纬度余弦把经度折算成等效纬度，再等比缩放到画布内，避免地块被横向拉伸。
 */
const projection = computed(() => {
  const points = plots.value.flatMap((plot) => plot.boundary || [])
  if (!points.length) {
    return null
  }
  const lngs = points.map((point) => Number(point[0]))
  const lats = points.map((point) => Number(point[1]))
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const lngFactor = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanX = (maxLng - minLng || 0.001) * lngFactor
  const spanY = maxLat - minLat || 0.001
  const scale = Math.min((VIEW_W - PADDING * 2) / spanX, (VIEW_H - PADDING * 2) / spanY)
  const offsetX = (VIEW_W - spanX * scale) / 2
  const offsetY = (VIEW_H - spanY * scale) / 2
  return {
    minLng,
    maxLat,
    lngFactor,
    scale,
    // 每像素对应的米数（经纬两轴相同，面积换算依赖该值）
    metersPerPx: METERS_PER_DEGREE / scale,
    toX: (lng) => offsetX + (lng - minLng) * lngFactor * scale,
    toY: (lat) => offsetY + (maxLat - lat) * scale
  }
})

/** 把经纬度边界转成画布坐标点 */
function boundaryToView(boundary) {
  if (!projection.value || !Array.isArray(boundary)) {
    return []
  }
  return boundary.map((point) => ({
    x: projection.value.toX(Number(point[0])),
    y: projection.value.toY(Number(point[1]))
  }))
}

/** 统一地块结构：A10 地块 + 本地绘制地块 */
const allPlots = computed(() => {
  const base = plots.value.map((plot) => {
    const points = boundaryToView(plot.boundary)
    return {
      ...plot,
      local: false,
      points,
      centroid: polygonCentroid(points)
    }
  })
  const local = localPlots.value.map((plot) => ({
    ...plot,
    local: true,
    centroid: polygonCentroid(plot.points)
  }))
  return [...base, ...local]
})

const totalPlotCount = computed(() => allPlots.value.length)

/** 选中地块 */
const selectedPlot = computed(
  () => allPlots.value.find((plot) => plot.id === selectedId.value) || null
)

/** 选中地块的设备数与最近告警 */
const selectedDeviceCount = computed(() =>
  selectedPlot.value
    ? devices.value.filter((row) => row.plotId === selectedPlot.value.id).length
    : 0
)

const selectedLatestAlarm = computed(() => {
  if (!selectedPlot.value) {
    return null
  }
  const rows = alarms.value.filter((row) => row.plotId === selectedPlot.value.id)
  if (!rows.length) {
    return null
  }
  return [...rows].sort(
    (left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt)
  )[0]
})

/** 设备点位：按地块分组后在包围盒内用黄金角散开，保证落在地块内 */
const devicePoints = computed(() => {
  const grouped = new Map()
  devices.value.forEach((device) => {
    const list = grouped.get(device.plotId) || []
    list.push(device)
    grouped.set(device.plotId, list)
  })
  const result = []
  grouped.forEach((list, plotId) => {
    const plot = allPlots.value.find((item) => item.id === plotId)
    if (!plot || plot.points.length < 3) {
      return
    }
    const box = bboxOf(plot.points)
    const radius = Math.max(12, Math.min(box.width, box.height) * 0.3)
    list.forEach((device, index) => {
      const angle = index * 2.399
      const distance = radius * Math.sqrt((index + 0.6) / list.length)
      result.push({
        key: device.code,
        plotId,
        device,
        x: plot.centroid.x + Math.cos(angle) * distance,
        y: plot.centroid.y + Math.sin(angle) * distance
      })
    })
  })
  return result
})

/** 告警点位：复用对应设备点位并做小偏移，避免完全重叠 */
const alarmPoints = computed(() => {
  const deviceMap = new Map(devicePoints.value.map((item) => [item.device.code, item]))
  return alarms.value
    .map((alarm, index) => {
      const base = deviceMap.get(alarm.deviceCode)
      if (!base) {
        return null
      }
      const offset = 5 + (index % 3)
      return {
        key: alarm.id,
        alarm,
        x: base.x + offset,
        y: base.y - offset
      }
    })
    .filter(Boolean)
})

/** 灌溉管线：各地块中心接到左下角泵房 */
const pipelinePoints = computed(() => {
  const pump = { x: 28, y: VIEW_H - 26 }
  return allPlots.value
    .filter((plot) => plot.points.length >= 3)
    .map((plot) => ({
      key: plot.id,
      from: pump,
      to: plot.centroid,
      name: plot.name
    }))
})

/** 绘制中的实时面积 */
const draftArea = computed(() => {
  if (!projection.value || draftPoints.value.length < 3) {
    return 0
  }
  return polygonAreaMu(draftPoints.value, projection.value.metersPerPx)
})

/** 底部列表数据 */
const tableRows = computed(() =>
  allPlots.value.map((plot) => ({
    id: plot.id,
    name: plot.name,
    areaMu: plot.areaMu,
    crop: plot.crop,
    deviceCount: plot.local ? 0 : devices.value.filter((row) => row.plotId === plot.id).length
  }))
)

/** 图层要素数文案：隐藏时显示 0/总数，便于核对图层状态 */
function layerCountText(layer) {
  const totalOf = {
    boundary: allPlots.value.length,
    devices: devices.value.length,
    alarms: alarms.value.length,
    pipeline: plots.value.length
  }
  const total = totalOf[layer] || 0
  return visibleLayers.value.includes(layer) ? String(total) : `0/${total}`
}

/** 时间串转毫秒，兼容 Safari 的连字符问题 */
function toTimestamp(text) {
  if (!text) {
    return 0
  }
  return new Date(String(text).replace(/-/g, '/')).getTime() || 0
}

/**
 * 多边形质心（顶点平均）。
 * @param {Array} points 画布坐标点
 * @returns {{x: number, y: number}} 质心
 */
function polygonCentroid(points) {
  if (!points.length) {
    return { x: 0, y: 0 }
  }
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/**
 * 点集包围盒。
 * @param {Array} points 画布坐标点
 * @returns {{x: number, y: number, width: number, height: number}} 包围盒
 */
function bboxOf(points) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY
  }
}

/**
 * 鞋带公式计算多边形面积并换算为亩。
 * @param {Array} points 画布坐标点
 * @param {number} metersPerPx 每像素米数
 * @returns {number} 面积（亩，保留 2 位）
 */
function polygonAreaMu(points, metersPerPx) {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }
  const areaPx = Math.abs(sum) / 2
  const areaM2 = areaPx * metersPerPx * metersPerPx
  return Math.round((areaM2 / SQUARE_METERS_PER_MU) * 100) / 100
}

/** 多边形 points 属性 */
function polygonPoints(points) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

/**
 * 屏幕坐标 → 画布坐标（兼容合成事件，鼠标与触屏都用 clientX/clientY）。
 * @param {MouseEvent} event 点击事件
 * @returns {{x: number, y: number}|null} 画布坐标
 */
function toViewPoint(event) {
  const svg = svgRef.value
  if (!svg || typeof svg.getScreenCTM !== 'function') {
    return null
  }
  const matrix = svg.getScreenCTM()
  if (!matrix) {
    return null
  }
  // 用 SVG 自带的点对象做坐标变换，避免依赖全局 DOMPoint
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: Math.round(local.x * 10) / 10, y: Math.round(local.y * 10) / 10 }
}

/** 选中地块 */
function selectPlot(plotId) {
  if (drawing.value) {
    return
  }
  selectedId.value = plotId
}

/** 进入绘制模式 */
function startDraw() {
  drawing.value = true
  draftPoints.value = []
  ElMessage.info('绘制模式：单击落点，双击闭合，Esc 退出')
}

/** 退出绘制模式 */
function cancelDraw() {
  drawing.value = false
  draftPoints.value = []
}

/** 撤销上一个落点 */
function undoPoint() {
  draftPoints.value = draftPoints.value.slice(0, -1)
}

/** 画布点击：绘制模式下追加落点 */
function handleSvgClick(event) {
  if (!drawing.value) {
    return
  }
  // 双击会先触发两次 click：260ms 内的重复落点直接忽略
  // 用事件自带的 timeStamp 计时，避免依赖 performance 全局
  const now = event.timeStamp
  if (now - lastPointAt < 260) {
    return
  }
  const point = toViewPoint(event)
  if (!point) {
    return
  }
  lastPointAt = now
  draftPoints.value = [...draftPoints.value, point]
}

/** 双击闭合：点数足够则打开命名弹窗 */
function handleDblClick() {
  if (!drawing.value) {
    return
  }
  if (draftPoints.value.length < 3) {
    ElMessage.warning('至少需要 3 个落点才能构成地块')
    return
  }
  drawForm.name = `新绘制地块 ${localPlots.value.length + 1}`
  drawForm.crop = '番茄'
  drawForm.manager = ''
  drawDialogVisible.value = true
}

/** 保存绘制地块：写入本地列表并重绘 */
async function saveDraw() {
  if (!drawFormRef.value || !projection.value) {
    return
  }
  try {
    await drawFormRef.value.validate()
  } catch {
    return
  }
  const points = draftPoints.value
  const areaMu = polygonAreaMu(points, projection.value.metersPerPx)
  const id = `LOCAL-${localPlots.value.length + 1}`
  localPlots.value = [
    ...localPlots.value,
    {
      id,
      code: id,
      name: drawForm.name,
      crop: drawForm.crop,
      variety: '-',
      areaMu,
      manager: drawForm.manager || '未指定',
      soil: '-',
      greenhouse: false,
      irrigation: '待接入',
      address: '地图绘制',
      boundary: [],
      points,
      updatedAt: '',
      updatedBy: '当前用户'
    }
  ]
  drawDialogVisible.value = false
  drawing.value = false
  draftPoints.value = []
  selectedId.value = id
  ElMessage.success(`地块「${drawForm.name}」已保存，面积 ${areaMu} 亩`)
}

/** 表格定位：选中地块并滚动到地图 */
function locatePlot(row) {
  selectedId.value = row.id
  svgRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** Esc 退出绘制 */
function handleKeydown(event) {
  if (event.key === 'Escape' && drawing.value) {
    cancelDraw()
  }
}

/** 载入 A10 地块、A03 设备、A19 告警 */
async function loadMap() {
  loading.value = true
  error.value = false
  try {
    const [plotData, deviceData, alarmData] = await Promise.all([
      fetchPlots({ page: 1, size: 50 }),
      fetchDevices({ page: 1, size: 100 }),
      fetchAlarms({ page: 1, size: 100 })
    ])
    plots.value = plotData?.list || []
    devices.value = deviceData?.list || []
    alarms.value = alarmData?.list || []
    if (!selectedId.value && allPlots.value.length) {
      selectedId.value = allPlots.value[0].id
    }
  } catch (err) {
    error.value = err?.code !== 40401
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadMap()
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="page-container gis-map">
    <AgriPageHeader
      page-id="P014"
      title="GIS 地图总览"
      description="在地块平面图上叠加设备、告警与灌溉管线，支持选中查看与实地绘制新地块。"
    >
      <template #extra>
        <span class="gis-map__summary">
          地块 {{ totalPlotCount }} · 设备 {{ devices.length }} · 告警 {{ alarms.length }}
        </span>
        <el-button v-if="!drawing" type="primary" @click="startDraw">绘制地块</el-button>
        <el-button v-else @click="cancelDraw">退出绘制</el-button>
      </template>
    </AgriPageHeader>

    <div v-if="error" class="gis-map__error" @click="loadMap">地图数据加载失败，点击重试</div>

    <div v-loading="loading" class="gis-map__body">
      <aside class="agri-card gis-map__layers">
        <h3 class="gis-map__panel-title">图层</h3>
        <el-checkbox-group v-model="visibleLayers" class="gis-map__layer-group">
          <el-checkbox v-for="layer in LAYER_ITEMS" :key="layer.value" :value="layer.value">
            {{ layer.label }}
          </el-checkbox>
        </el-checkbox-group>
        <ul class="gis-map__layer-count">
          <li v-for="layer in LAYER_ITEMS" :key="layer.value">
            <span>{{ layer.label }}</span>
            <span class="gis-map__layer-num">{{ layerCountText(layer.value) }}</span>
          </li>
        </ul>
        <p class="gis-map__panel-note">
          地图为 SVG 平面图，按 A10 边界经纬度等距投影（1000×600）。
        </p>
      </aside>

      <section class="agri-card gis-map__canvas">
        <div v-if="drawing" class="gis-map__hint">
          <span>绘制中：已落 {{ draftPoints.length }} 点 · 面积 {{ draftArea }} 亩</span>
          <span class="gis-map__hint-actions">
            <el-button link type="primary" @click.stop="undoPoint">撤销上一点</el-button>
            <el-button link type="primary" @click.stop="cancelDraw">取消</el-button>
          </span>
        </div>
        <svg
          ref="svgRef"
          class="gis-map__svg"
          :class="{ 'gis-map__svg--drawing': drawing }"
          :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="地块平面图"
          @click="handleSvgClick"
          @dblclick="handleDblClick"
        >
          <rect :width="VIEW_W" :height="VIEW_H" class="gis-map__bg" />

          <g v-if="visibleLayers.includes('pipeline')" class="gis-map__pipeline-group">
            <line
              v-for="line in pipelinePoints"
              :key="line.key"
              class="gis-map__pipeline"
              :x1="line.from.x"
              :y1="line.from.y"
              :x2="line.to.x"
              :y2="line.to.y"
            />
            <circle :cx="28" :cy="VIEW_H - 26" r="6" class="gis-map__pump" />
          </g>

          <g v-if="visibleLayers.includes('boundary')" class="gis-map__boundary-group">
            <polygon
              v-for="plot in allPlots"
              :key="plot.id"
              class="gis-map__polygon"
              :class="{
                'gis-map__polygon--active': plot.id === selectedId,
                'gis-map__polygon--local': plot.local
              }"
              :points="polygonPoints(plot.points)"
              @click="selectPlot(plot.id)"
            >
              <title>{{ plot.name }} · {{ plot.areaMu }} 亩</title>
            </polygon>
            <text
              v-for="plot in allPlots"
              :key="`label-${plot.id}`"
              class="gis-map__label"
              :x="plot.centroid.x"
              :y="plot.centroid.y"
              text-anchor="middle"
              @click="selectPlot(plot.id)"
            >
              <tspan :x="plot.centroid.x" dy="0">{{ plot.name }}</tspan>
              <tspan :x="plot.centroid.x" dy="16" class="gis-map__label-sub">
                {{ plot.areaMu }} 亩
              </tspan>
            </text>
          </g>

          <g v-if="visibleLayers.includes('alarms')" class="gis-map__alarm-group">
            <circle
              v-for="alarm in alarmPoints"
              :key="alarm.key"
              class="gis-map__alarm"
              :cx="alarm.x"
              :cy="alarm.y"
              r="4.5"
            >
              <title>
                {{ alarm.alarm.levelName }} · {{ alarm.alarm.typeName }}（{{
                  alarm.alarm.plotName
                }}）
              </title>
            </circle>
          </g>

          <g v-if="visibleLayers.includes('devices')" class="gis-map__device-group">
            <circle
              v-for="point in devicePoints"
              :key="point.key"
              class="gis-map__device"
              :class="`gis-map__device--${String(point.device.status).toLowerCase()}`"
              :cx="point.x"
              :cy="point.y"
              r="3.6"
            >
              <title>
                {{ point.device.name }}（{{ point.device.code }}）· {{ point.device.statusName }}
              </title>
            </circle>
          </g>

          <g v-if="drawing" class="gis-map__draft-group">
            <polyline
              v-if="draftPoints.length > 1"
              class="gis-map__draft-line"
              :points="polygonPoints(draftPoints)"
            />
            <polygon
              v-if="draftPoints.length > 2"
              class="gis-map__draft-area"
              :points="polygonPoints(draftPoints)"
            />
            <circle
              v-for="(point, index) in draftPoints"
              :key="`draft-${index}`"
              class="gis-map__draft-point"
              :cx="point.x"
              :cy="point.y"
              r="4"
            />
          </g>
        </svg>
        <div v-if="!allPlots.length && !loading" class="gis-map__empty">
          <AgriEmpty description="暂无地块边界数据，可点击「绘制地块」手动绘制" height="240px" />
        </div>
      </section>

      <aside class="agri-card gis-map__info">
        <h3 class="gis-map__panel-title">地块信息</h3>
        <template v-if="selectedPlot">
          <div class="gis-map__info-name">
            {{ selectedPlot.name }}
            <el-tag v-if="selectedPlot.local" size="small" type="warning" effect="plain"
              >本地绘制</el-tag
            >
          </div>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item label="面积">{{ selectedPlot.areaMu }} 亩</el-descriptions-item>
            <el-descriptions-item label="作物">{{ selectedPlot.crop }}</el-descriptions-item>
            <el-descriptions-item label="品种">{{
              selectedPlot.variety || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="土壤类型">{{
              selectedPlot.soil || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="设备数">{{ selectedDeviceCount }} 台</el-descriptions-item>
            <el-descriptions-item label="负责人">{{
              selectedPlot.manager || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="灌溉方式">{{
              selectedPlot.irrigation || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="最近告警">
              <span v-if="selectedLatestAlarm">
                {{ selectedLatestAlarm.levelName }} · {{ selectedLatestAlarm.typeName }}<br />
                <span class="gis-map__info-sub">{{ selectedLatestAlarm.createdAt }}</span>
              </span>
              <span v-else class="gis-map__info-sub">暂无告警</span>
            </el-descriptions-item>
          </el-descriptions>
          <p v-if="selectedPlot.local" class="gis-map__panel-note">
            本地绘制地块仅保存在当前会话，刷新后消失；如需落库请调用 A10 边界更新。
          </p>
        </template>
        <AgriEmpty v-else description="点击左侧地块查看详细信息" height="220px" />
      </aside>
    </div>

    <div class="agri-card gis-map__table">
      <div class="gis-map__table-head">
        <h3 class="gis-map__panel-title">地块列表</h3>
        <span class="text-secondary"
          >共 {{ totalPlotCount }} 块，含本地绘制 {{ localPlots.length }} 块</span
        >
      </div>
      <AgriTable
        :columns="columns"
        :data="tableRows"
        :loading="loading"
        :show-pagination="false"
        row-key="id"
        empty-text="暂无地块，点击「绘制地块」创建第一块"
      >
        <template #area="{ row }">{{ row.areaMu?.toFixed(2) }}</template>
        <template #deviceCount="{ row }">{{ row.deviceCount }} 台</template>
        <template #actions="{ row }">
          <el-button link type="primary" @click="locatePlot(row)">定位</el-button>
        </template>
      </AgriTable>
    </div>

    <el-dialog v-model="drawDialogVisible" title="保存绘制的地块" width="460px">
      <el-form ref="drawFormRef" :model="drawForm" :rules="drawRules" label-width="80px">
        <el-form-item label="地块名称" prop="name">
          <el-input v-model="drawForm.name" placeholder="请输入地块名称" />
        </el-form-item>
        <el-form-item label="作物" prop="crop">
          <el-select v-model="drawForm.crop" class="gis-map__full">
            <el-option v-for="crop in CROP_OPTIONS" :key="crop" :label="crop" :value="crop" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="drawForm.manager" placeholder="选填" />
        </el-form-item>
        <el-form-item label="面积">
          <span class="gis-map__draw-area">{{ draftArea }} 亩（鞋带公式自动计算）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDraw">保存地块</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.gis-map__summary {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.gis-map__body {
  display: flex;
  gap: 16px;
  align-items: stretch;
  margin-bottom: 16px;
}

.gis-map__layers {
  flex: 0 0 190px;
  padding: 16px;
}

.gis-map__canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 12px;
}

.gis-map__info {
  flex: 0 0 260px;
  padding: 16px;
}

.gis-map__panel-title {
  margin: 0 0 10px;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.gis-map__panel-note {
  margin: 10px 0 0;
  font-size: $font-size-xs;
  line-height: 1.7;
  color: $text-secondary;
}

.gis-map__layer-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gis-map__layer-count {
  margin: 10px 0 0;
  padding: 8px 0 0;
  list-style: none;
  border-top: 1px dashed $border-color;

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 0;
    font-size: $font-size-xs;
    color: $text-secondary;
  }
}

.gis-map__layer-num {
  font-variant-numeric: tabular-nums;
  color: $text-primary;
}

.gis-map__svg {
  display: block;
  width: 100%;
  height: auto;
  border-radius: $radius-md;
  cursor: default;
}

.gis-map__svg--drawing {
  cursor: crosshair;
}

.gis-map__bg {
  fill: #f0f6f2;
  stroke: $border-color;
  stroke-width: 1;
}

.gis-map__polygon {
  fill: rgba(46, 125, 88, 0.22);
  stroke: #2e7d58;
  stroke-width: 1.6;
  cursor: pointer;
  transition: fill 0.2s ease;

  &:hover {
    fill: rgba(46, 125, 88, 0.4);
  }
}

.gis-map__polygon--active {
  fill: rgba(46, 125, 88, 0.46);
  stroke: #1b5e3f;
  stroke-width: 2.6;
}

.gis-map__polygon--local {
  stroke-dasharray: 6 4;
  fill: rgba(230, 162, 60, 0.24);
}

.gis-map__label {
  font-size: 12px;
  fill: $text-primary;
  cursor: pointer;
  pointer-events: auto;
}

.gis-map__label-sub {
  font-size: 11px;
  fill: #5c6b7a;
}

.gis-map__device {
  fill: #2e7d58;
  stroke: #ffffff;
  stroke-width: 1;

  &--offline {
    fill: #e6a23c;
  }

  &--fault {
    fill: #f56c6c;
  }
}

.gis-map__alarm {
  fill: #f56c6c;
  opacity: 0.85;
  stroke: #ffffff;
  stroke-width: 0.8;
}

.gis-map__pipeline {
  stroke: #3a8fd0;
  stroke-width: 1.6;
  stroke-dasharray: 5 4;
  opacity: 0.75;
}

.gis-map__pump {
  fill: #3a8fd0;
  stroke: #ffffff;
  stroke-width: 1.2;
}

.gis-map__draft-line {
  fill: none;
  stroke: #e6a23c;
  stroke-width: 2;
  stroke-dasharray: 5 4;
}

.gis-map__draft-area {
  fill: rgba(230, 162, 60, 0.25);
  stroke: #e6a23c;
  stroke-width: 1.6;
}

.gis-map__draft-point {
  fill: #ffffff;
  stroke: #e6a23c;
  stroke-width: 2;
}

.gis-map__hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding: 6px 10px;
  font-size: $font-size-xs;
  color: #8a6d1f;
  background: rgba(230, 162, 60, 0.14);
  border-radius: $radius-sm;
}

.gis-map__hint-actions {
  display: flex;
  gap: 4px;
}

.gis-map__info-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.gis-map__info-sub {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.gis-map__table-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.gis-map__table {
  margin-bottom: 16px;
}

.gis-map__empty {
  padding: 12px 0;
}

.gis-map__full {
  width: 100%;
}

.gis-map__draw-area {
  font-size: $font-size-sm;
  color: $primary-color;
}

.gis-map__error {
  margin-bottom: 16px;
  padding: $space-lg 0;
  text-align: center;
  color: $danger-color;
  background: $bg-page;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
  cursor: pointer;
}
</style>
