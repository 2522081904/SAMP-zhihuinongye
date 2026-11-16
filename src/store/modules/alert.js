/**
 * 告警状态：未处理告警数、告警筛选条件。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAlertStore = defineStore('alert', () => {
  // 顶栏红点使用的未处理告警数量
  const pendingCount = ref(0)
  const filter = ref({ level: '', status: 'pending', module: '' })

  function setPendingCount(count) {
    pendingCount.value = Number(count) || 0
  }

  function setFilter(value) {
    filter.value = { ...filter.value, ...value }
  }

  return { pendingCount, filter, setPendingCount, setFilter }
})
