/**
 * 农事状态：当前农事计划、工单统计。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useFarmStore = defineStore('farm', () => {
  const activePlanId = ref('')
  const taskSummary = ref({ pending: 0, doing: 0, done: 0 })

  function setActivePlan(planId) {
    activePlanId.value = planId
  }

  function setTaskSummary(summary) {
    taskSummary.value = { ...taskSummary.value, ...summary }
  }

  return { activePlanId, taskSummary, setActivePlan, setTaskSummary }
})
