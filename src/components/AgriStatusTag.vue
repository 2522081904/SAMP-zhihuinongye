<script setup>
/**
 * 通用状态标签
 * - 把后端状态码映射成中文文案 + el-tag 色调
 * - 内置农业告警、设备状态、处置状态、质检状态四组常用映射
 * - 业务侧可用 map 覆盖或追加，未命中时兜底显示原始值（灰色）
 */
import { computed } from 'vue'

defineOptions({ name: 'AgriStatusTag' })

const props = defineProps({
  // 状态值，如 ONLINE / PENDING / 合格
  status: { type: [String, Number], default: '' },
  // 自定义映射：{ [key]: { text, type } }，优先级高于内置映射
  map: { type: Object, default: () => ({}) }
})

// 内置映射：设备在线状态 + 告警状态 + 处置状态 + 质检状态
const DEFAULT_MAP = {
  // 设备状态
  ONLINE: { text: '在线', type: 'success' },
  OFFLINE: { text: '离线', type: 'info' },
  FAULT: { text: '故障', type: 'danger' },
  RUNNING: { text: '运行中', type: 'success' },
  STOPPED: { text: '已停止', type: 'info' },
  // 告警级别
  CRITICAL: { text: '严重', type: 'danger' },
  MAJOR: { text: '重要', type: 'warning' },
  MINOR: { text: '次要', type: 'info' },
  // 告警处置状态
  PENDING: { text: '待处置', type: 'warning' },
  CONFIRMED: { text: '已确认', type: 'primary' },
  RESOLVED: { text: '已处置', type: 'success' },
  IGNORED: { text: '已忽略', type: 'info' },
  // 质检状态
  QUALIFIED: { text: '合格', type: 'success' },
  UNQUALIFIED: { text: '不合格', type: 'danger' },
  // 中文直接命中
  在线: { text: '在线', type: 'success' },
  离线: { text: '离线', type: 'info' },
  告警: { text: '告警', type: 'danger' },
  待处置: { text: '待处置', type: 'warning' },
  已处置: { text: '已处置', type: 'success' },
  合格: { text: '合格', type: 'success' },
  不合格: { text: '不合格', type: 'danger' }
}

// 当前状态对应的展示配置
const current = computed(() => {
  const key = props.status
  const custom = props.map && props.map[key]
  if (custom) {
    return { text: custom.text ?? String(key), type: custom.type || 'info' }
  }
  const preset = DEFAULT_MAP[key]
  if (preset) {
    return preset
  }
  return { text: key === '' || key === null || key === undefined ? '-' : String(key), type: 'info' }
})
</script>

<template>
  <el-tag :type="current.type" size="small" effect="light" class="agri-status-tag">
    {{ current.text }}
  </el-tag>
</template>

<style scoped lang="scss">
.agri-status-tag {
  // 标签本身用 Element Plus 语义色，这里只做统一圆角与字号
  border-radius: $radius-sm;
  font-size: $font-size-xs;
}
</style>
