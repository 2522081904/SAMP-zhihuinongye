/**
 * 物联网状态：当前选中基地、设备筛选条件、实时数据缓存。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useIotStore = defineStore('iot', () => {
  // 当前选中基地
  const currentBaseId = ref('base-001')
  // 实时环境数据（骨架阶段为空，接入接口后填充）
  const realtimeEnv = ref(null)
  // 设备列表筛选条件
  const deviceFilter = ref({ keyword: '', status: '', type: '' })

  function setCurrentBase(baseId) {
    currentBaseId.value = baseId
  }

  function setRealtimeEnv(data) {
    realtimeEnv.value = data
  }

  function setDeviceFilter(filter) {
    deviceFilter.value = { ...deviceFilter.value, ...filter }
  }

  return {
    currentBaseId,
    realtimeEnv,
    deviceFilter,
    setCurrentBase,
    setRealtimeEnv,
    setDeviceFilter
  }
})
