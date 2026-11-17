/**
 * 列表页数据 composable
 * 把「筛选条件 + 分页 + loading + 列表」收在一处，页面只需要提供取数函数。
 * 分页参数严格使用接口契约的 { page, size }，不保留旧的分页字段名。
 */
import { reactive, ref } from 'vue'

import { usePagination } from './usePagination'

/**
 * 过滤条件里的空值不参与请求：空串、null、undefined 与空数组直接丢掉，
 * 避免后端把 `plotId=` 当成一个真实的过滤条件。
 * @param {Object} source 原始参数
 * @returns {Object} 清理后的参数
 */
function omitEmpty(source) {
  const result = {}
  Object.keys(source).forEach((key) => {
    const value = source[key]
    if (value === '' || value === null || value === undefined) {
      return
    }
    if (Array.isArray(value) && value.length === 0) {
      return
    }
    result[key] = value
  })
  return result
}

/**
 * @param {Function} fetchFn 取数函数，接收合并后的查询参数，返回数组或 { list, total }
 * @param {Object} [defaultFilters={}] 过滤条件默认值，resetAll 时会回到这里
 * @param {Object} [paginationOptions={}] 分页初始配置（小列表页可传 { size: 5 }）
 * @returns {Object} 列表状态与操作方法
 */
export function useTable(fetchFn, defaultFilters = {}, paginationOptions = {}) {
  const loading = ref(false)
  const list = ref([])
  const filters = reactive({ ...defaultFilters })
  const { pagination, pageSizes, pageCount, setTotal, handlePageChange, handleSizeChange, reset } =
    usePagination(paginationOptions)

  /**
   * 加载列表数据。
   * @param {Object} [extraParams={}] 额外参数，最后合并（可临时覆盖 page/size 或追加接口参数）
   * @returns {Promise<Object>} 接口返回的原始分页数据，便于页面读取其他字段
   */
  async function loadData(extraParams = {}) {
    loading.value = true
    try {
      const params = omitEmpty({
        ...filters,
        page: pagination.page,
        size: pagination.size,
        ...extraParams
      })
      const data = await fetchFn(params)
      if (Array.isArray(data)) {
        list.value = data
        setTotal(data.length)
      } else {
        list.value = data?.list || []
        setTotal(data?.total || 0)
      }
      return data
    } finally {
      loading.value = false
    }
  }

  /** 查询：筛选条件变化后回到第 1 页再取数 */
  async function search() {
    pagination.page = 1
    return loadData()
  }

  /** 重置筛选条件并重新查询 */
  async function resetAll() {
    Object.keys(filters).forEach((key) => {
      filters[key] = defaultFilters[key] ?? ''
    })
    reset()
    return loadData()
  }

  /**
   * 组件翻页事件：更新页码后取数。
   * @param {number|{page:number,size:number}} payload 页码或 { page, size }
   */
  async function onPageChange(payload) {
    handlePageChange(typeof payload === 'object' ? payload.page : payload)
    return loadData()
  }

  /**
   * 组件切换每页条数事件：更新条数并回到第 1 页后取数。
   * @param {number|{page:number,size:number}} payload 条数或 { page, size }
   */
  async function onSizeChange(payload) {
    handleSizeChange(typeof payload === 'object' ? payload.size : payload)
    return loadData()
  }

  return {
    loading,
    list,
    filters,
    pagination,
    pageSizes,
    pageCount,
    loadData,
    search,
    resetAll,
    onPageChange,
    onSizeChange,
    handlePageChange,
    handleSizeChange,
    setTotal
  }
}
