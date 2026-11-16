/**
 * 应用级状态：侧边菜单折叠、页面标题、设备断点标记。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  // 侧边菜单是否折叠
  const sidebarCollapsed = ref(false)
  // 当前页面标题（由路由守卫写入）
  const pageTitle = ref('')
  // 是否处于窄屏（移动端适配）
  const isMobile = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setPageTitle(title) {
    pageTitle.value = title
    document.title = title ? `${title} - 智慧农业综合管理平台` : '智慧农业综合管理平台'
  }

  function setMobile(value) {
    isMobile.value = Boolean(value)
  }

  return {
    sidebarCollapsed,
    pageTitle,
    isMobile,
    toggleSidebar,
    setPageTitle,
    setMobile
  }
})
