<script setup>
/**
 * P024 GIS 空间统计与图层管理
 * 数据来源：A10 地块（含边界）、A20 GIS 统计、A03 设备台账、A19 告警列表、A15 采收批次。
 * 说明：
 * - 周长由 A10 边界经纬度按与地图页一致的投影换算为米；
 * - 单位面积产量用 A15 采收批次按地块汇总 ÷ A10 面积（只有前 4 块地有采收数据，其余显示横杠）；
 * - 图层透明度与可见性在右上角图层示意图上实时生效，便于核对图层配置。
 */
import { computed, onMounted, reactive, ref } from 'vue'

import {
  fetchAlarms,
  fetchDevices,
  fetchGisStatistics,
  fetchHarvestBatches,
  fetchPlots
} from '@/api'
import AgriChart from '@/components/AgriChart.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriTable from '@/components/AgriTable.vue'

defineOptions({ name: 'GisMapStatsPage' })

// 图层示意图画布尺寸
const VIEW_W = 400
const VIEW_H = 240
// 每度纬度对应米数（与 GIS 地图页保持同一口径）
const METERS_PER_DEGREE = 111320

// 图层元数据
const LAYER_META = {
  boundary: { name: '地块边界', typeName: '地块' },
  devices: { name: '设备点位', typeName: '设备' },
  alarms: { name: '告警点位', typeName: '告警' },
  pipeline: { name: '灌溉管线', typeName: '管线' }
}

const loading = ref(false)
const error = ref(false)

const plots = ref([])
const devices = ref([])
const alarms = ref([])
const statistics = ref(null)
const harvestList = ref([])

// 图层可见性与透明度
const layerState = reactive({
  boundary: { visible: true, opacity: 80 },
  devices: { visible: true, opacity: 90 },
  alarms: { visible: true, opacity: 85 },
  pipeline: { visible: true, opacity: 70 }
})
// 图层排序（上移/下移直接调整数组顺序）
const layerOrder = ref(['boundary', 'devices', 'alarms', 'pipeline'])

const plotCount = computed(() => statistics.value?.plotCount ?? plots.value.length)
const totalAreaMu = computed(() => statistics.value?.totalAreaMu ?? 0)
const deviceCount = computed(() => devices.value.length)
const alarmCount = computed(() => alarms.value.length)

/** 经纬度 → 示意图坐标的等距投影（与地图页同一算法） */
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
  const scale = Math.min((VIEW_W - 40) / spanX, (VIEW_H - 40) / spanY)
  const offsetX = (VIEW_W - spanX * scale) / 2
  const offsetY = (VIEW_H - spanY * scale) / 2
  return {
    metersPerPx: METERS_PER_DEGREE / scale,
    toX: (lng) => offsetX + (lng - minLng) * lngFactor * scale,
    toY: (lat) => offsetY + (maxLat - lat) * scale
  }
})

/** 各地块在示意图上的多边形点 */
const plotShapes = computed(() => {
  if (!projection.value) {
    return []
  }
  return plots.value.map((plot) => {
    const points = (plot.boundary || []).map((point) => ({
      x: projection.value.toX(Number(point[0])),
      y: projection.value.toY(Number(point[1]))
    }))
    return { id: plot.id, name: plot.name, points, centroid: centroidOf(points) }
  })
})

/** 设备点位：每个地块按黄金角在内部分布 */
const deviceDots = computed(() => {
  const grouped = new Map()
  devices.value.forEach((device) => {
    const list = grouped.get(device.plotId) || []
    list.push(device)
    grouped.set(device.plotId, list)
  })
  const result = []
  plotShapes.value.forEach((shape) => {
    const list = grouped.get(shape.id) || []
    list.forEach((device, index) => {
      const angle = index * 2.399
      const distance = 10 * Math.sqrt((index + 0.6) / Math.max(list.length, 1))
      result.push({
        key: device.code,
        x: shape.centroid.x + Math.cos(angle) * distance,
        y: shape.centroid.y + Math.sin(angle) * distance
      })
    })
  })
  return result
})

/** 告警点位：按地块顺序分布，避免与设备点位完全重合 */
const alarmDots = computed(() => {
  const grouped = new Map()
  alarms.value.forEach((alarm) => {
    const list = grouped.get(alarm.plotId) || []
    list.push(alarm)
    grouped.set(alarm.plotId, list)
  })
  const result = []
  plotShapes.value.forEach((shape) => {
    const list = grouped.get(shape.id) || []
    list.forEach((alarm, index) => {
      const angle = index * 1.7 + 0.8
      const distance = 16 + (index % 3) * 4
      result.push({
        key: alarm.id,
        x: shape.centroid.x + Math.cos(angle) * distance,
        y: shape.centroid.y + Math.sin(angle) * distance
      })
    })
  })
  return result
})

/** 灌溉管线：各地块中心接到左下角泵房 */
const pipelineLines = computed(() => {
  const pump = { x: 18, y: VIEW_H - 16 }
  return plotShapes.value.map((shape) => ({
    key: shape.id,
    from: pump,
    to: shape.centroid
  }))
})

/** 图层要素数 */
function layerTotal(key) {
  if (key === 'devices') {
    return deviceCount.value
  }
  if (key === 'alarms') {
    return alarmCount.value
  }
  return plots.value.length
}

/** 图层管理表数据 */
const layerRows = computed(() =>
  layerOrder.value.map((key, index) => ({
    key,
    name: LAYER_META[key].name,
    typeName: LAYER_META[key].typeName,
    total: layerTotal(key),
    visible: layerState[key].visible,
    opacity: layerState[key].opacity,
    order: index + 1
  }))
)

/** 图层管理列 */
const layerColumns = [
  { prop: 'order', label: '序号', width: 56 },
  { prop: 'name', label: '图层名', minWidth: 118 },
  { prop: 'typeName', label: '类型', width: 64 },
  { prop: 'elementCount', label: '要素数', width: 84, slot: 'elementCount' },
  { prop: 'visible', label: '可见性', width: 74, slot: 'visible' },
  { prop: 'opacity', label: '透明度', width: 132, slot: 'opacity' },
  { prop: 'sort', label: '排序', width: 104, slot: 'sort' }
]

/** 空间统计表列 */
const statColumns = [
  { prop: 'name', label: '地块', minWidth: 170 },
  { prop: 'areaMu', label: '面积（亩）', width: 120, slot: 'areaMu' },
  { prop: 'perimeter', label: '周长（米）', width: 120, slot: 'perimeter' },
  { prop: 'deviceCount', label: '设备数', width: 100, slot: 'deviceCount' },
  { prop: 'alarmCount', label: '告警数', width: 100, slot: 'alarmCount' },
  { prop: 'yieldPerMu', label: '单位面积产量（kg/亩）', minWidth: 180, slot: 'yieldPerMu' }
]

/** 各地块告警数（按 A19 聚合） */
const alarmByPlot = computed(() => {
  const bucket = new Map()
  alarms.value.forEach((alarm) => {
    bucket.set(alarm.plotName, (bucket.get(alarm.plotName) || 0) + 1)
  })
  return [...bucket.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
})

/** 各地块设备数 */
function deviceCountOfPlot(plotId) {
  return devices.value.filter((device) => device.plotId === plotId).length
}

/** 各地块告警数 */
function alarmCountOfPlot(plotId) {
  return alarms.value.filter((alarm) => alarm.plotId === plotId).length
}

/** 各地块采收总量（A15） */
const harvestByPlot = computed(() => {
  const bucket = new Map()
  harvestList.value.forEach((batch) => {
    bucket.set(batch.plotId, (bucket.get(batch.plotId) || 0) + Number(batch.quantityKg || 0))
  })
  return bucket
})

/**
 * 地块周长：按边界顶点在示意图坐标下的线段长度累加，再换算成米。
 * @param {Object} plot 地块
 * @returns {number} 周长（米，保留 1 位）
 */
function perimeterOf(plot) {
  if (!projection.value) {
    return 0
  }
  const points = (plot.boundary || []).map((point) => ({
    x: projection.value.toX(Number(point[0])),
    y: projection.value.toY(Number(point[1]))
  }))
  if (points.length < 2) {
    return 0
  }
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    total += Math.hypot(next.x - current.x, next.y - current.y)
  }
  return Math.round(total * projection.value.metersPerPx * 10) / 10
}

/** 空间统计表数据 */
const statRows = computed(() =>
  plots.value.map((plot) => {
    const harvested = harvestByPlot.value.get(plot.id) || 0
    return {
      id: plot.id,
      name: plot.name,
      areaMu: plot.areaMu,
      perimeter: perimeterOf(plot),
      deviceCount: deviceCountOfPlot(plot.id),
      alarmCount: alarmCountOfPlot(plot.id),
      // 没有采收批次的地块不展示单位面积产量
      yieldPerMu: harvested ? Math.round((harvested / plot.areaMu) * 10) / 10 : null
    }
  })
)

/** 各地块面积占比：饼图 */
const areaOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 亩（{d}%）' },
  // 图例立式放在右侧，避免 8 个地块名挤在底部被截断
  legend: {
    orient: 'vertical',
    right: 4,
    top: 'middle',
    type: 'scroll',
    itemWidth: 10,
    itemHeight: 8,
    itemGap: 8,
    textStyle: { fontSize: 11 }
  },
  series: [
    {
      name: '地块面积',
      type: 'pie',
      radius: ['34%', '56%'],
      center: ['34%', '52%'],
      label: { show: false },
      labelLine: { show: false },
      data: plots.value.map((plot) => ({
        name: plot.shortName || plot.name,
        value: plot.areaMu
      }))
    }
  ]
}))

/** 各地块告警数：柱状图 */
const alarmOption = computed(() => ({
  grid: { left: 46, right: 16, top: 28, bottom: 60 },
  tooltip: { trigger: 'axis', valueFormatter: (value) => `${value} 条` },
  xAxis: {
    type: 'category',
    data: alarmByPlot.value.map((item) => item.name),
    axisLabel: { fontSize: 11, interval: 0, rotate: 24 }
  },
  yAxis: {
    type: 'value',
    name: '条',
    minInterval: 1,
    nameTextStyle: { fontSize: 11 },
    splitLine: { lineStyle: { type: 'dashed' } }
  },
  series: [
    {
      name: '告警数',
      type: 'bar',
      barWidth: '48%',
      itemStyle: { color: '#f56c6c', borderRadius: [4, 4, 0, 0] },
      data: alarmByPlot.value.map((item) => item.value)
    }
  ]
}))

/** 地块-作物分布：横向条形图（按作物统计面积） */
const cropOption = computed(() => {
  const rows = [...(statistics.value?.byCrop || [])].sort(
    (left, right) => left.areaMu - right.areaMu
  )
  return {
    grid: { left: 76, right: 40, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${value} 亩` },
    xAxis: { type: 'value', name: '亩', nameTextStyle: { fontSize: 11 } },
    yAxis: {
      type: 'category',
      data: rows.map((item) => item.name),
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        name: '种植面积',
        type: 'bar',
        barWidth: '52%',
        itemStyle: { color: '#2e7d58', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 11, formatter: '{c} 亩' },
        data: rows.map((item) => item.areaMu)
      }
    ]
  }
})

/** 图层示意图上某个图层的透明度 */
function layerOpacity(key) {
  return layerState[key].opacity / 100
}

/** 多边形 points 属性 */
function polygonPoints(points) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

/**
 * 多边形质心（顶点平均）。
 * @param {Array} points 坐标点
 * @returns {{x: number, y: number}} 质心
 */
function centroidOf(points) {
  if (!points.length) {
    return { x: 0, y: 0 }
  }
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0
  })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** 图层上移 */
function moveUp(index) {
  if (index <= 0) {
    return
  }
  const next = [...layerOrder.value]
  const [item] = next.splice(index, 1)
  next.splice(index - 1, 0, item)
  layerOrder.value = next
}

/** 图层下移 */
function moveDown(index) {
  if (index >= layerOrder.value.length - 1) {
    return
  }
  const next = [...layerOrder.value]
  const [item] = next.splice(index, 1)
  next.splice(index + 1, 0, item)
  layerOrder.value = next
}

/** 载入全部数据 */
async function loadData() {
  loading.value = true
  error.value = false
  try {
    const [plotData, deviceData, alarmData, statData, harvestData] = await Promise.all([
      fetchPlots({ page: 1, size: 50 }),
      fetchDevices({ page: 1, size: 100 }),
      fetchAlarms({ page: 1, size: 100 }),
      fetchGisStatistics(),
      fetchHarvestBatches({ page: 1, size: 100 })
    ])
    plots.value = plotData?.list || []
    devices.value = deviceData?.list || []
    alarms.value = alarmData?.list || []
    statistics.value = statData || null
    harvestList.value = harvestData?.list || []
  } catch (err) {
    error.value = err?.code !== 40401
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="page-container gis-stats">
    <AgriPageHeader
      page-id="P024"
      title="空间统计与图层管理"
      description="按地块汇总面积、周长、设备与告警分布，并管理图层的可见性、透明度与顺序。"
    />

    <div v-if="error" class="gis-stats__error" @click="loadData">
      空间统计数据加载失败，点击重试
    </div>

    <section class="gis-stats__stats">
      <AgriStatCard
        label="地块总数"
        :value="plotCount"
        unit="块"
        icon="Grid"
        tone="brand"
        :loading="loading"
      />
      <AgriStatCard
        label="总面积"
        :value="totalAreaMu"
        unit="亩"
        icon="Crop"
        tone="ok"
        :loading="loading"
      />
      <AgriStatCard
        label="设备点位"
        :value="deviceCount"
        unit="个"
        icon="Cpu"
        tone="brand"
        :loading="loading"
      />
      <AgriStatCard
        label="告警点位"
        :value="alarmCount"
        unit="个"
        icon="WarningFilled"
        tone="danger"
        :loading="loading"
      />
    </section>

    <section class="gis-stats__charts">
      <div class="agri-card gis-stats__chart-card">
        <h3 class="gis-stats__card-title">各地块面积占比</h3>
        <AgriChart
          :option="areaOption"
          :loading="loading"
          :empty="!plots.length"
          empty-text="暂无地块面积数据"
          height="280px"
        />
      </div>
      <div class="agri-card gis-stats__chart-card">
        <h3 class="gis-stats__card-title">各地块告警数</h3>
        <AgriChart
          :option="alarmOption"
          :loading="loading"
          :empty="!alarmByPlot.length"
          empty-text="暂无告警数据"
          height="280px"
        />
      </div>
      <div class="agri-card gis-stats__chart-card">
        <h3 class="gis-stats__card-title">地块-作物分布</h3>
        <AgriChart
          :option="cropOption"
          :loading="loading"
          :empty="!statistics?.byCrop?.length"
          empty-text="暂无作物分布数据"
          height="280px"
        />
      </div>
    </section>

    <section class="gis-stats__layers">
      <div class="agri-card gis-stats__layer-table">
        <div class="gis-stats__head">
          <h3 class="gis-stats__card-title">图层管理</h3>
          <span class="gis-stats__hint">
            可见图层 {{ layerRows.filter((row) => row.visible).length }} /
            {{ layerRows.length }}
          </span>
        </div>
        <AgriTable
          :columns="layerColumns"
          :data="layerRows"
          :loading="loading"
          :show-pagination="false"
          row-key="key"
          empty-text="暂无图层"
        >
          <template #elementCount="{ row }">
            {{ row.visible ? row.total : `0/${row.total}` }}
          </template>
          <template #visible="{ row }">
            <el-switch v-model="layerState[row.key].visible" size="small" />
          </template>
          <template #opacity="{ row }">
            <div class="gis-stats__opacity">
              <el-slider
                v-model="layerState[row.key].opacity"
                :min="10"
                :max="100"
                :step="5"
                size="small"
                :show-tooltip="false"
              />
              <span class="gis-stats__opacity-num">{{ row.opacity }}%</span>
            </div>
          </template>
          <template #sort="{ row }">
            <el-button
              link
              type="primary"
              :disabled="row.order === 1"
              @click="moveUp(row.order - 1)"
            >
              上移
            </el-button>
            <el-button
              link
              type="primary"
              :disabled="row.order === layerRows.length"
              @click="moveDown(row.order - 1)"
            >
              下移
            </el-button>
          </template>
        </AgriTable>
      </div>

      <div class="agri-card gis-stats__mini">
        <h3 class="gis-stats__card-title">图层示意图</h3>
        <svg
          class="gis-stats__svg"
          :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="图层示意图"
        >
          <rect :width="VIEW_W" :height="VIEW_H" class="gis-stats__bg" />
          <g v-if="layerState.pipeline.visible" :opacity="layerOpacity('pipeline')">
            <line
              v-for="line in pipelineLines"
              :key="`pipeline-${line.key}`"
              class="gis-stats__pipeline"
              :x1="line.from.x"
              :y1="line.from.y"
              :x2="line.to.x"
              :y2="line.to.y"
            />
          </g>
          <g v-if="layerState.boundary.visible" :opacity="layerOpacity('boundary')">
            <polygon
              v-for="shape in plotShapes"
              :key="`plot-${shape.id}`"
              class="gis-stats__polygon"
              :points="polygonPoints(shape.points)"
            />
          </g>
          <g v-if="layerState.alarms.visible" :opacity="layerOpacity('alarms')">
            <circle
              v-for="dot in alarmDots"
              :key="`alarm-${dot.key}`"
              class="gis-stats__alarm"
              :cx="dot.x"
              :cy="dot.y"
              r="3"
            />
          </g>
          <g v-if="layerState.devices.visible" :opacity="layerOpacity('devices')">
            <circle
              v-for="dot in deviceDots"
              :key="`device-${dot.key}`"
              class="gis-stats__device"
              :cx="dot.x"
              :cy="dot.y"
              r="2"
            />
          </g>
        </svg>
        <p class="gis-stats__note">
          示意图同步反映上方图层的可见性与透明度设置；设备点位 {{ deviceDots.length }} 个、 告警点位
          {{ alarmDots.length }} 个。
        </p>
      </div>
    </section>

    <div class="agri-card gis-stats__table">
      <div class="gis-stats__head">
        <h3 class="gis-stats__card-title">空间统计</h3>
        <span class="gis-stats__hint">单位面积产量来自 A15 采收批次，暂无采收的地块不展示</span>
      </div>
      <AgriTable
        :columns="statColumns"
        :data="statRows"
        :loading="loading"
        :show-pagination="false"
        row-key="id"
        empty-text="暂无地块空间统计数据"
      >
        <template #areaMu="{ row }">{{ row.areaMu?.toFixed(2) }}</template>
        <template #perimeter="{ row }">{{ row.perimeter?.toFixed(1) }}</template>
        <template #deviceCount="{ row }">{{ row.deviceCount }} 台</template>
        <template #alarmCount="{ row }">{{ row.alarmCount }} 条</template>
        <template #yieldPerMu="{ row }">
          {{ row.yieldPerMu === null ? '-' : row.yieldPerMu.toFixed(1) }}
        </template>
      </AgriTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.gis-stats__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.gis-stats__charts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.gis-stats__chart-card {
  padding: 16px;
}

.gis-stats__card-title {
  margin: 0 0 12px;
  font-size: $font-size-sm;
  font-weight: 600;
  color: $text-primary;
}

.gis-stats__layers {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(300px, 0.9fr);
  gap: 16px;
  margin-bottom: 16px;
}

.gis-stats__layer-table {
  padding: 16px;

  // 图层表列较多，操作按钮压紧避免换行
  :deep(.el-button) {
    padding: 0 2px;
    font-size: $font-size-xs;
  }

  :deep(.el-slider) {
    margin: 0 2px;
  }
}

.gis-stats__mini {
  padding: 16px;
}

.gis-stats__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.gis-stats__hint {
  font-size: $font-size-xs;
  color: $text-secondary;
}

.gis-stats__svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid $border-color;
  border-radius: $radius-md;
}

.gis-stats__bg {
  fill: #f0f6f2;
}

.gis-stats__polygon {
  fill: rgba(46, 125, 88, 0.28);
  stroke: #2e7d58;
  stroke-width: 1.2;
}

.gis-stats__device {
  fill: #1f6b4d;
}

.gis-stats__alarm {
  fill: #f56c6c;
}

.gis-stats__pipeline {
  stroke: #3a8fd0;
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
}

.gis-stats__opacity {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gis-stats__opacity-num {
  flex: none;
  width: 30px;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.gis-stats__note {
  margin: 10px 0 0;
  font-size: $font-size-xs;
  line-height: 1.7;
  color: $text-secondary;
}

.gis-stats__table {
  padding: 16px;
  margin-bottom: 16px;
}

.gis-stats__error {
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
  .gis-stats__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gis-stats__charts,
  .gis-stats__layers {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
