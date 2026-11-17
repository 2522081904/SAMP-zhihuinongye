<script setup>
/**
 * 通用数据表格
 * - 列配置驱动，支持具名插槽自定义单元格、formatter、排序、固定列
 * - 分页受控：page/size 由父组件传入，组件只抛事件，不修改自身 props
 * - 空态统一使用 AgriEmpty，点分页、勾选、排序、行点击均向父组件透传
 */
import { ref, useSlots } from 'vue'

import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AgriTable' })

const props = defineProps({
  // 列配置：{ prop, label, width, minWidth, align, sortable, slot, formatter, fixed, showOverflowTooltip }
  columns: { type: Array, default: () => [] },
  data: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  rowKey: { type: String, default: 'id' },
  emptyText: { type: String, default: '暂无数据' },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  size: { type: Number, default: 10 },
  pageSizes: { type: Array, default: () => [10, 20, 50, 100] },
  showPagination: { type: Boolean, default: true },
  stripe: { type: Boolean, default: true },
  border: { type: Boolean, default: false },
  height: { type: [Number, String], default: undefined },
  maxHeight: { type: [Number, String], default: undefined },
  // 是否显示多选列
  selection: { type: Boolean, default: false }
})

const emit = defineEmits([
  'page-change',
  'size-change',
  'update:page',
  'update:size',
  'selection-change',
  'sort-change',
  'row-click'
])

const slots = useSlots()
const tableRef = ref(null)

/**
 * 支持 'a.b' 形式的嵌套字段路径。
 * @param {Object} row 行数据
 * @param {string} path 字段路径
 * @returns {*} 字段值
 */
function getByPath(row, path) {
  if (!row || !path) {
    return undefined
  }
  if (!path.includes('.')) {
    return row[path]
  }
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), row)
}

/**
 * 计算单元格展示值：优先 formatter，空值统一显示 '-'。
 * @param {Object} row 行数据
 * @param {Object} column 列配置
 * @returns {*} 展示值
 */
function resolveCell(row, column) {
  const raw = getByPath(row, column.prop)
  const value = typeof column.formatter === 'function' ? column.formatter(raw, row, column) : raw
  if (value === null || value === undefined || value === '') {
    return '-'
  }
  return value
}

/**
 * 取列对应的插槽名：显式 slot 优先，否则用 prop 作为插槽名。
 * @param {Object} column 列配置
 * @returns {string} 插槽名
 */
function slotName(column) {
  return column.slot || column.prop || ''
}

/** 页码变化：先抛 update:page 支持 v-model，再抛业务事件 */
function onCurrentChange(nextPage) {
  emit('update:page', nextPage)
  emit('page-change', { page: nextPage, size: props.size })
}

/** 每页条数变化：由父组件决定是否回到第 1 页 */
function onSizeChange(nextSize) {
  emit('update:size', nextSize)
  emit('size-change', { page: 1, size: nextSize })
}

/** 多选变化直接透传选中的行 */
function onSelectionChange(rows) {
  emit('selection-change', rows)
}

/** 排序变化透传 Element Plus 的 { column, prop, order } */
function onSortChange(payload) {
  emit('sort-change', payload)
}

/** 行点击透传 (row, column, event) */
function onRowClick(row, column, event) {
  emit('row-click', row, column, event)
}

defineExpose({
  tableRef,
  clearSelection: () => tableRef.value?.clearSelection(),
  toggleRowSelection: (row, selected) => tableRef.value?.toggleRowSelection(row, selected)
})
</script>

<template>
  <div class="agri-table">
    <!-- 右上角操作区：由页面放新增/导出等按钮 -->
    <div v-if="slots.toolbar" class="agri-table__toolbar">
      <slot name="toolbar" />
    </div>

    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="data"
      :row-key="rowKey"
      :stripe="stripe"
      :border="border"
      :height="height"
      :max-height="maxHeight"
      class="agri-table__body"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
      @row-click="onRowClick"
    >
      <!-- 多选列：默认按 rowKey 维护选中状态 -->
      <el-table-column v-if="selection" type="selection" width="48" align="center" />

      <el-table-column
        v-for="column in columns"
        :key="column.prop || column.label"
        :prop="column.prop"
        :label="column.label"
        :width="column.width"
        :min-width="column.minWidth || 120"
        :align="column.align || 'left'"
        :header-align="column.align || 'left'"
        :sortable="column.sortable || false"
        :fixed="column.fixed || false"
        :show-overflow-tooltip="Boolean(column.showOverflowTooltip)"
      >
        <template #default="scope">
          <!-- 页面通过 columns[].slot 指定具名插槽；未指定时按 prop 兜底 -->
          <slot
            :name="slotName(column)"
            :row="scope.row"
            :value="resolveCell(scope.row, column)"
            :index="scope.$index"
          >
            {{ resolveCell(scope.row, column) }}
          </slot>
        </template>
      </el-table-column>

      <!-- 空态：统一使用 AgriEmpty，页面可通过 #empty 覆盖 -->
      <template #empty>
        <slot name="empty">
          <AgriEmpty :description="emptyText" height="160px" />
        </slot>
      </template>
    </el-table>

    <!-- 分页：页码与条数均受控，只向父组件抛事件 -->
    <div v-if="showPagination && total > 0" class="agri-table__pagination">
      <el-pagination
        background
        :current-page="page"
        :page-size="size"
        :page-sizes="pageSizes"
        :total="total"
        :pager-count="5"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="onCurrentChange"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-table {
  width: 100%;
  min-width: 0;
  background-color: $bg-card;
  border-radius: $radius-md;
}

.agri-table__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.agri-table__body {
  width: 100%;
}

.agri-table__pagination {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: $space-md;
}

// 窄屏：隐藏合计/条数/跳页，只保留翻页，避免 375px 下横向溢出
@media (max-width: 640px) {
  .agri-table__pagination {
    justify-content: center;
  }

  .agri-table__pagination :deep(.el-pagination__total),
  .agri-table__pagination :deep(.el-pagination__sizes),
  .agri-table__pagination :deep(.el-pagination__jump) {
    display: none;
  }
}
</style>
