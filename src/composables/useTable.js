/**
 * 表格数据组合式函数
 * 封装 loading、列表数据、查询条件与刷新逻辑，页面只关心 fetch 函数。
 */
import { reactive, ref } from 'vue'
import { usePagination } from '@/composables/usePagination'

/**
 * @param {Function} fetchFn 列表请求函数，入参为 { ...filters, pageNum, pageSize }，返回 { list, total }
 * @param {Object} defaultFilters 默认查询条件
 */
export function useTable(fetchFn, defaultFilters = {}) {
  const loading = ref(false)
  const list = ref([])
  const filters = reactive({ ...defaultFilters })
  const { pagination, setTotal, handlePageChange, handleSizeChange, reset } = usePagination()

  async function loadData() {
    if (typeof fetchFn !== 'function') {
      return
    }
    loading.value = true
    try {
      const result = await fetchFn({
        ...filters,
        pageNum: pagination.page,
        pageSize: pagination.pageSize
      })
      // 兼容 { list, total } 与直接返回数组两种形态
      if (Array.isArray(result)) {
        list.value = result
        setTotal(result.length)
      } else {
        list.value = result?.list || []
        setTotal(result?.total || 0)
      }
    } finally {
      loading.value = false
    }
  }

  function search() {
    pagination.page = 1
    return loadData()
  }

  function resetAll() {
    Object.keys(filters).forEach((key) => {
      filters[key] = defaultFilters[key] ?? ''
    })
    reset()
    return loadData()
  }

  return {
    loading,
    list,
    filters,
    pagination,
    loadData,
    search,
    resetAll,
    handlePageChange,
    handleSizeChange
  }
}
