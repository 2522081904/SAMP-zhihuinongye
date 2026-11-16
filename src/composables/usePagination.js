/**
 * 分页组合式函数
 * 统一维护 page / pageSize / total，并提供页码切换、每页条数切换、重置能力。
 */
import { computed, reactive, ref } from 'vue'

export function usePagination(options = {}) {
  const { page = 1, pageSize = 10, pageSizes = [10, 20, 50, 100] } = options

  const pagination = reactive({
    page,
    pageSize,
    total: 0
  })

  // 总页数，供分页组件展示
  const pageCount = computed(() => Math.ceil(pagination.total / pagination.pageSize) || 0)

  function setTotal(total) {
    pagination.total = Number(total) || 0
  }

  function handlePageChange(nextPage) {
    pagination.page = nextPage
  }

  function handleSizeChange(nextSize) {
    pagination.pageSize = nextSize
    pagination.page = 1
  }

  function reset() {
    pagination.page = 1
    pagination.total = 0
  }

  // 请求参数：接口统一使用 pageNum / pageSize 命名
  const query = computed(() => ({ pageNum: pagination.page, pageSize: pagination.pageSize }))

  return {
    pagination,
    pageCount,
    pageSizes: ref(pageSizes),
    query,
    setTotal,
    handlePageChange,
    handleSizeChange,
    reset
  }
}
