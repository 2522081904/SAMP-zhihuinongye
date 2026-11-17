/**
 * 分页状态 composable
 * 与接口契约保持一致：请求参数使用 { page, size }（page 从 1 开始），
 * 响应分页结构为 { page, size, total, list }。
 * 组件只读取 page/size/total 并抛事件，状态的变更统一由这里负责。
 */
import { computed, reactive } from 'vue'

/**
 * @param {Object} [options] 初始分页配置
 * @param {number} [options.page=1] 初始页码
 * @param {number} [options.size=10] 初始每页条数
 * @param {number[]} [options.pageSizes=[10, 20, 50, 100]] 可选的每页条数
 * @returns {Object} 分页状态与操作方法
 */
export function usePagination(options = {}) {
  const { page = 1, size = 10, pageSizes = [10, 20, 50, 100] } = options

  // 分页三要素：当前页、每页条数、总条数
  const pagination = reactive({
    page: Number(page) || 1,
    size: Number(size) || 10,
    total: 0
  })

  // 总页数：无数据时为 0，避免出现「第 1/0 页」
  const pageCount = computed(() => Math.ceil(pagination.total / pagination.size) || 0)

  /** 更新总条数（列表接口返回后调用） */
  function setTotal(total) {
    pagination.total = Number(total) || 0
  }

  /** 切换页码：由组件事件传入，只更新状态，具体取数由页面调用 loadData */
  function handlePageChange(nextPage) {
    const numericPage = Number(nextPage)
    pagination.page = Number.isFinite(numericPage) && numericPage > 0 ? numericPage : 1
  }

  /**
   * 切换每页条数：按约定重置到第 1 页，避免停留在超出范围的页码。
   * @param {number} nextSize 新的每页条数
   */
  function handleSizeChange(nextSize) {
    const numericSize = Number(nextSize)
    if (Number.isFinite(numericSize) && numericSize > 0) {
      pagination.size = numericSize
    }
    pagination.page = 1
  }

  /** 重置分页：搜索、筛选条件变化或清空列表时调用 */
  function reset() {
    pagination.page = 1
    pagination.total = 0
  }

  // 直接透传给接口的查询参数，页面不需要再手写分页字段
  const query = computed(() => ({
    page: pagination.page,
    size: pagination.size
  }))

  return {
    pagination,
    pageSizes,
    pageCount,
    query,
    setTotal,
    handlePageChange,
    handleSizeChange,
    reset
  }
}
