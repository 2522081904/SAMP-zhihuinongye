<script setup>
/**
 * 通用表单弹窗
 * - 字段配置驱动，支持 input / textarea / number / select / date / daterange / switch / radio
 * - 打开时按 defaultValues + editData 重置表单，关闭后可再次打开复用
 * - 提交前执行 el-form.validate()，校验通过才抛 submit（payload 为深拷贝）
 * - 自身不调用接口，提交/取消都交给父组件处理
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

defineOptions({ name: 'AgriFormDialog' })

const props = defineProps({
  // 弹窗显隐，配合 v-model 使用
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // 字段配置：{ prop, label, type, options, placeholder, required, span, disabled, tip }
  fields: { type: Array, default: () => [] },
  // 表单校验规则，格式同 el-form rules
  rules: { type: Object, default: () => ({}) },
  // 弹窗宽度：数字按 px，字符串原样
  width: { type: [Number, String], default: 560 },
  // 提交中状态，控制「确定」按钮 loading
  loading: { type: Boolean, default: false },
  submitText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  labelWidth: { type: String, default: '96px' },
  // 新增时的默认值
  defaultValues: { type: Object, default: () => ({}) },
  // 编辑时的回填数据，优先级高于 defaultValues
  editData: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:modelValue', 'submit', 'cancel', 'closed', 'field-change'])

const formRef = ref(null)
const form = reactive({})
const rangeDisplay = reactive({})
const isNarrow = ref(false)

let mediaQuery = null

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 窄屏时用视口宽度撑满，避免 560px 定宽在手机上横向溢出
const dialogWidth = computed(() => {
  if (isNarrow.value) {
    return 'calc(100vw - 32px)'
  }
  return typeof props.width === 'number' ? `${props.width}px` : props.width
})

/** 深拷贝表单数据，避免父组件直接拿到内部引用 */
function deepClone(source) {
  if (!source || typeof source !== 'object') {
    return {}
  }
  return JSON.parse(JSON.stringify(source))
}

/**
 * 字段默认值：switch 为 false，数字为 null，日期范围为 []，其余为空串。
 * @param {Object} field 字段配置
 * @returns {*} 默认值
 */
function defaultValue(field) {
  if (field.type === 'switch') {
    return false
  }
  if (field.type === 'number') {
    return null
  }
  if (field.type === 'daterange') {
    return []
  }
  return ''
}

/**
 * 生成基础值：defaultValues 打底，editData 覆盖。
 * @returns {Object} 回填数据源
 */
function buildSource() {
  return { ...deepClone(props.defaultValues), ...deepClone(props.editData) }
}

/** 用 defaultValues + editData 重置内部表单 */
function resetForm() {
  const source = buildSource()
  // 清掉上一次的字段，避免残留自定义字段
  Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, source)

  props.fields.forEach((field) => {
    const value = source[field.prop]
    if (field.type === 'daterange') {
      const range = Array.isArray(value) ? value : []
      form[field.prop] = range
      rangeDisplay[field.prop] = range.map((item) => String(item).slice(0, 10))
      return
    }
    if (value === undefined || value === null) {
      form[field.prop] = defaultValue(field)
      return
    }
    form[field.prop] = value
  })

  nextTick(() => formRef.value?.clearValidate())
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      resetForm()
    }
  }
)

// 编辑数据在打开状态下变化时同步回填
watch(
  () => props.editData,
  () => {
    if (props.modelValue) {
      resetForm()
    }
  },
  { deep: true }
)

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(max-width: 640px)')
    isNarrow.value = mediaQuery.matches
    mediaQuery.addEventListener('change', handleMediaChange)
  }
})

onBeforeUnmount(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', handleMediaChange)
  }
})

/** 断点变化时更新弹窗宽度 */
function handleMediaChange(event) {
  isNarrow.value = event.matches
}

/**
 * 合并校验规则：公共 rules + 字段自带 rules + required 自动规则。
 * @returns {Object} el-form 可用的规则对象
 */
const mergedRules = computed(() => {
  const result = { ...(props.rules || {}) }
  props.fields.forEach((field) => {
    const fieldRules = []
    if (field.required) {
      const isInput = ['input', 'textarea', 'number'].includes(field.type)
      fieldRules.push({
        required: true,
        message: `${isInput ? '请输入' : '请选择'}${field.label || field.prop}`,
        trigger: isInput ? 'blur' : 'change'
      })
    }
    if (Array.isArray(field.rules)) {
      fieldRules.push(...field.rules)
    } else if (field.rules) {
      fieldRules.push(field.rules)
    }
    if (!fieldRules.length) {
      return
    }
    const existing = result[field.prop]
    result[field.prop] = [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      ...fieldRules
    ]
  })
  return result
})

/**
 * 单字段更新，直接写内部表单。
 * @param {string} prop 字段名
 * @param {*} value 字段值
 */
function setField(prop, value) {
  form[prop] = value
  emit('field-change', { prop, value })
}

/**
 * 日期范围变化：控件给 yyyy-MM-dd，对外统一存完整时间串。
 * @param {Object} field 字段配置
 * @param {string[]|null} dates 日期数组
 */
function onRangeChange(field, dates) {
  if (Array.isArray(dates) && dates.length === 2) {
    form[field.prop] = [`${dates[0]} 00:00:00`, `${dates[1]} 23:59:59`]
  } else {
    form[field.prop] = []
  }
}

/** 提交：校验通过后把深拷贝的表单值交给父组件 */
async function handleSubmit() {
  if (!formRef.value) {
    return
  }
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  emit('submit', deepClone(form))
}

/** 取消：抛 cancel 并关闭弹窗 */
function handleCancel() {
  emit('cancel')
  dialogVisible.value = false
}

/** 弹窗彻底关闭后抛 closed，父组件可在此清理数据 */
function handleClosed() {
  emit('closed')
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
      return { label: option.label ?? String(option.value ?? ''), value: option.value }
    }
    return { label: String(option), value: option }
  })
}

/**
 * 字段占几列：span=2 占满整行，默认 1 占半行。
 * @param {Object} field 字段配置
 * @returns {number} 24 栅格下的 span
 */
function colSpan(field) {
  const span = Math.min(2, Math.max(1, Number(field.span) || 1))
  return span * 12
}

defineExpose({
  validate: () => formRef.value?.validate(),
  resetFields: resetForm,
  getForm: () => deepClone(form),
  setField
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="title"
    :width="dialogWidth"
    append-to-body
    :close-on-click-modal="false"
    class="agri-form-dialog"
    @closed="handleClosed"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="mergedRules"
      :label-width="labelWidth"
      class="agri-form-dialog__form"
    >
      <el-row :gutter="16">
        <el-col v-for="field in fields" :key="field.prop" :span="colSpan(field)">
          <el-form-item :label="field.label" :prop="field.prop">
            <el-input
              v-if="field.type === 'input'"
              :model-value="form[field.prop]"
              :placeholder="field.placeholder || `请输入${field.label}`"
              :disabled="field.disabled"
              clearable
              @update:model-value="setField(field.prop, $event)"
            />

            <el-input
              v-else-if="field.type === 'textarea'"
              :model-value="form[field.prop]"
              type="textarea"
              :rows="3"
              :placeholder="field.placeholder || `请输入${field.label}`"
              :disabled="field.disabled"
              @update:model-value="setField(field.prop, $event)"
            />

            <el-input-number
              v-else-if="field.type === 'number'"
              :model-value="form[field.prop]"
              :placeholder="field.placeholder || `请输入${field.label}`"
              :disabled="field.disabled"
              :controls-position="'right'"
              class="agri-form-dialog__control"
              @update:model-value="setField(field.prop, $event)"
            />

            <el-select
              v-else-if="field.type === 'select'"
              :model-value="form[field.prop]"
              :placeholder="field.placeholder || `请选择${field.label}`"
              :disabled="field.disabled"
              clearable
              filterable
              class="agri-form-dialog__control"
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
              :model-value="form[field.prop]"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="field.placeholder || `请选择${field.label}`"
              :disabled="field.disabled"
              class="agri-form-dialog__control"
              @update:model-value="setField(field.prop, $event)"
            />

            <el-date-picker
              v-else-if="field.type === 'daterange'"
              v-model="rangeDisplay[field.prop]"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              :disabled="field.disabled"
              class="agri-form-dialog__control"
              @change="onRangeChange(field, $event)"
            />

            <el-switch
              v-else-if="field.type === 'switch'"
              :model-value="form[field.prop]"
              :disabled="field.disabled"
              @update:model-value="setField(field.prop, $event)"
            />

            <el-radio-group
              v-else-if="field.type === 'radio'"
              :model-value="form[field.prop]"
              :disabled="field.disabled"
              @update:model-value="setField(field.prop, $event)"
            >
              <el-radio
                v-for="option in normalizeOptions(field.options)"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </el-radio>
            </el-radio-group>

            <!-- 兜底：未知类型按普通输入框处理 -->
            <el-input
              v-else
              :model-value="form[field.prop]"
              :placeholder="field.placeholder || `请输入${field.label}`"
              :disabled="field.disabled"
              @update:model-value="setField(field.prop, $event)"
            />

            <div v-if="field.tip" class="agri-form-dialog__tip">{{ field.tip }}</div>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <template #footer>
      <el-button @click="handleCancel">{{ cancelText }}</el-button>
      <el-button type="primary" :loading="loading" @click="handleSubmit">
        {{ submitText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.agri-form-dialog__form {
  padding-top: $space-xs;
}

.agri-form-dialog__control {
  width: 100%;
}

.agri-form-dialog__tip {
  margin-top: $space-xs;
  font-size: $font-size-xs;
  line-height: 1.5;
  color: $text-secondary;
}
</style>
