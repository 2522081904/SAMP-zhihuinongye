<script setup>
/**
 * 通用查询条件栏
 * - 字段配置驱动，支持 input / select / date / daterange / number
 * - 查询对象与父组件双向同步：字段变化即抛 update:modelValue
 * - 回车或点击「查询」抛 search；「重置」清空字段并抛 reset
 * - 字段超过 4 个且 collapsible=true 时默认折叠，只展示前 4 个
 */
import { computed, reactive, ref, watch } from 'vue'

defineOptions({ name: 'AgriSearchBar' })

const props = defineProps({
  // 字段配置：{ prop, label, type, options, placeholder, width }
  fields: { type: Array, default: () => [] },
  // 查询对象，字段名与接口参数一致
  modelValue: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  // 字段多于 4 个时是否允许折叠
  collapsible: { type: Boolean, default: true }
})

const emit = defineEmits(['update:modelValue', 'search', 'reset'])

// 折叠阈值：超过 4 个字段才出现「展开/收起」
const COLLAPSE_THRESHOLD = 4

const form = reactive({})
const rangeDisplay = reactive({})
const expanded = ref(false)

const needCollapse = computed(() => props.collapsible && props.fields.length > COLLAPSE_THRESHOLD)

const visibleFields = computed(() => {
  if (!needCollapse.value || expanded.value) {
    return props.fields
  }
  return props.fields.slice(0, COLLAPSE_THRESHOLD)
})

/**
 * 字段默认值：日期范围用空数组，数字用 null，其余用空串。
 * @param {Object} field 字段配置
 * @returns {*} 默认值
 */
function defaultValue(field) {
  if (field.type === 'daterange') {
    return []
  }
  if (field.type === 'number') {
    return null
  }
  return ''
}

/**
 * 把外部值规整成控件可用的类型。
 * @param {Object} field 字段配置
 * @param {*} value 外部值
 * @returns {*} 规整后的值
 */
function normalizeValue(field, value) {
  if (field.type === 'daterange') {
    return Array.isArray(value) ? value : []
  }
  if (field.type === 'number') {
    if (value === '' || value === null || value === undefined) {
      return null
    }
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return value === undefined || value === null ? '' : value
}

/**
 * 用父组件的 modelValue 同步内部表单，同时维护日期范围的显示值。
 * @param {Object} value 查询对象
 */
function applyModel(value) {
  const source = value || {}
  props.fields.forEach((field) => {
    const normalized = normalizeValue(field, source[field.prop])
    form[field.prop] = normalized
    if (field.type === 'daterange') {
      // 外部存完整时间串，控件只认 yyyy-MM-dd，这里截断后单独维护
      rangeDisplay[field.prop] = normalized.map((item) => String(item).slice(0, 10))
    }
  })
}

watch(() => props.modelValue, applyModel, { deep: true, immediate: true })

// 字段动态增加时补默认值（例如地块列表异步加载后才出现某字段）
watch(
  () => props.fields,
  () => {
    props.fields.forEach((field) => {
      if (!(field.prop in form)) {
        form[field.prop] = defaultValue(field)
        if (field.type === 'daterange') {
          rangeDisplay[field.prop] = []
        }
      }
    })
  },
  { deep: true }
)

/** 把内部表单整体同步给父组件 */
function emitModel() {
  emit('update:modelValue', { ...form })
}

/**
 * 单字段更新：写入内部状态并立即同步给父组件。
 * @param {string} prop 字段名
 * @param {*} value 字段值
 */
function setField(prop, value) {
  form[prop] = value
  emitModel()
}

/**
 * 日期范围变化：控件给 yyyy-MM-dd，对外统一转成完整时间串。
 * @param {Object} field 字段配置
 * @param {string[]|null} dates 日期数组
 */
function onRangeChange(field, dates) {
  if (Array.isArray(dates) && dates.length === 2) {
    setField(field.prop, [`${dates[0]} 00:00:00`, `${dates[1]} 23:59:59`])
  } else {
    setField(field.prop, [])
  }
}

/** 点击查询 / 回车：先同步一次最新值，再抛 search */
function handleSearch() {
  emitModel()
  emit('search', { ...form })
}

/** 重置：所有字段回到默认值，再抛 reset */
function handleReset() {
  props.fields.forEach((field) => {
    form[field.prop] = defaultValue(field)
    if (field.type === 'daterange') {
      rangeDisplay[field.prop] = []
    }
  })
  emitModel()
  emit('reset')
}

/** 展开 / 收起 */
function toggleExpand() {
  expanded.value = !expanded.value
}

/**
 * 兼容字符串与 { label, value } 两种选项写法。
 * @param {Array} options 原始选项
 * @returns {Array<{label:string,value:*}>} 规整后的选项
 */
function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    return []
  }
  return options.map((option) => {
    if (option !== null && typeof option === 'object') {
      return {
        label: option.label ?? String(option.value ?? ''),
        value: option.value
      }
    }
    return { label: String(option), value: option }
  })
}

/**
 * 字段宽度：数字按 px，字符串原样，按控件类型给默认值。
 * @param {Object} field 字段配置
 * @returns {string} CSS 宽度
 */
function fieldWidth(field) {
  if (typeof field.width === 'number') {
    return `${field.width}px`
  }
  if (typeof field.width === 'string' && field.width) {
    return field.width
  }
  if (field.type === 'daterange') {
    return '320px'
  }
  if (field.type === 'select') {
    return '200px'
  }
  if (field.type === 'number') {
    return '160px'
  }
  return '220px'
}
</script>

<template>
  <div class="agri-search-bar" @keyup.enter="handleSearch">
    <div class="agri-search-bar__fields">
      <div
        v-for="field in visibleFields"
        :key="field.prop"
        class="agri-search-bar__field"
        :style="{ '--agri-field-width': fieldWidth(field) }"
      >
        <label class="agri-search-bar__label" :for="`agri-search-${field.prop}`">
          {{ field.label }}
        </label>

        <el-input
          v-if="field.type === 'input'"
          :id="`agri-search-${field.prop}`"
          :model-value="form[field.prop]"
          :placeholder="field.placeholder || `请输入${field.label}`"
          clearable
          @update:model-value="setField(field.prop, $event)"
        />

        <el-input-number
          v-else-if="field.type === 'number'"
          :id="`agri-search-${field.prop}`"
          :model-value="form[field.prop]"
          :placeholder="field.placeholder || `请输入${field.label}`"
          :controls-position="'right'"
          class="agri-search-bar__number"
          @update:model-value="setField(field.prop, $event)"
        />

        <el-select
          v-else-if="field.type === 'select'"
          :id="`agri-search-${field.prop}`"
          :model-value="form[field.prop]"
          :placeholder="field.placeholder || `请选择${field.label}`"
          clearable
          filterable
          @update:model-value="setField(field.prop, $event)"
        >
          <el-option
            v-for="option in normalizeOptions(field.options)"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>

        <el-date-picker
          v-else-if="field.type === 'date'"
          :id="`agri-search-${field.prop}`"
          :model-value="form[field.prop]"
          type="date"
          value-format="YYYY-MM-DD"
          :placeholder="field.placeholder || `请选择${field.label}`"
          class="agri-search-bar__date"
          @update:model-value="setField(field.prop, $event)"
        />

        <el-date-picker
          v-else-if="field.type === 'daterange'"
          :id="`agri-search-${field.prop}`"
          v-model="rangeDisplay[field.prop]"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="agri-search-bar__date"
          @change="onRangeChange(field, $event)"
        />
      </div>

      <div class="agri-search-bar__actions">
        <el-button type="primary" :loading="loading" @click="handleSearch">查询</el-button>
        <el-button :disabled="loading" @click="handleReset">重置</el-button>
        <el-button v-if="needCollapse" link type="primary" @click="toggleExpand">
          {{ expanded ? '收起' : '展开' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-search-bar {
  width: 100%;
  min-width: 0;
  padding: $space-md;
  background-color: $bg-card;
  border-radius: $radius-md;
}

.agri-search-bar__fields {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-sm $space-md;
}

.agri-search-bar__field {
  display: flex;
  flex: 1 1 var(--agri-field-width, 220px);
  align-items: center;
  gap: $space-sm;
  min-width: 0;
  max-width: 100%;
}

.agri-search-bar__label {
  flex: 0 0 auto;
  font-size: $font-size-sm;
  color: $text-regular;
  white-space: nowrap;
}

.agri-search-bar__field :deep(.el-input),
.agri-search-bar__field :deep(.el-select),
.agri-search-bar__field :deep(.el-date-editor) {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}

.agri-search-bar__number {
  width: 100%;
}

.agri-search-bar__date {
  width: 100%;
}

.agri-search-bar__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-sm;
  margin-left: auto;
}

// 窄屏：每个字段独占一行，避免 375px 下横向滚动
@media (max-width: 640px) {
  .agri-search-bar__field {
    flex-basis: 100%;
  }

  .agri-search-bar__actions {
    width: 100%;
    margin-left: 0;
  }
}
</style>
