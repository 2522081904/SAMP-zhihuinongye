<script setup>
/**
 * 通用表格组件
 * 在 el-table 之上统一 loading、空状态与分页条，列配置通过 columns 传入。
 * columns 元素结构：{ prop, label, width, minWidth, align, formatter }
 */
import AgriEmpty from '@/components/AgriEmpty.vue'

defineOptions({ name: 'AgriTable' })

const props = defineProps({
  // 表格列配置
  columns: {
    type: Array,
    default: () => []
  },
  // 表格数据
  data: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  // 行主键
  rowKey: {
    type: String,
    default: 'id'
  },
  emptyText: {
    type: String,
    default: '暂无数据'
  }
})

// 以行主键取值，避免不同接口字段命名差异影响渲染
function resolveValue(row, column) {
  const raw = row?.[column.prop]
  return typeof column.formatter === 'function' ? column.formatter(raw, row) : raw
}
</script>

<template>
  <div class="agri-table">
    <el-table v-loading="props.loading" :data="props.data" :row-key="props.rowKey" border stripe>
      <el-table-column
        v-for="column in props.columns"
        :key="column.prop"
        :prop="column.prop"
        :label="column.label"
        :width="column.width"
        :min-width="column.minWidth || 120"
        :align="column.align || 'left'"
      >
        <template #default="{ row }">
          <slot :name="column.prop" :row="row" :value="resolveValue(row, column)">
            {{ resolveValue(row, column) ?? '-' }}
          </slot>
        </template>
      </el-table-column>
      <template #empty>
        <AgriEmpty :description="props.emptyText" height="160px" />
      </template>
    </el-table>
    <div v-if="$slots.footer" class="agri-table__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.agri-table {
  width: 100%;
  background-color: $bg-card;
  border-radius: $radius-md;
}

.agri-table__footer {
  display: flex;
  justify-content: flex-end;
  padding: $space-md 0;
}
</style>
