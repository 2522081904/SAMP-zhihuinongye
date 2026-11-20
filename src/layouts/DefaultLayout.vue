<script setup>
/**
 * PC 端默认布局
 * 结构：左侧模块化侧边菜单 + 顶部栏（折叠按钮 / 面包屑 / 用户信息）+ 内容区 router-view。
 * 菜单数据由 router/index.js 的 pcRoutes 聚合生成，新增页面只需加路由模块，无需改本文件。
 * 窄屏（≤768px）适配：侧栏收进 el-drawer，主区自适应铺满，避免 375px 下出现横向滚动条。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/store/modules/app'
import { useUserStore } from '@/store/modules/user'
import { useAlertStore } from '@/store/modules/alert'
import { pcRoutes } from '@/router'
import buildMenuGroups from '@/router/menu'
import AgriMobileEntry from '@/components/AgriMobileEntry.vue'

defineOptions({ name: 'DefaultLayout' })

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const userStore = useUserStore()
const alertStore = useAlertStore()

// 菜单按当前角色权限过滤：不同角色可见页面不同，无权页面不出现在菜单里。
// 必须用 computed —— profile 是异步拉取的，首次渲染时 permissions 还是空数组，
// 普通 const 会把「空菜单」定格下来；computed 会在权限到位后自动重算。
// hasPerm 内部读取的是 store 的 permissions，因此这里能正确收集到响应式依赖。
const menuGroups = computed(() => buildMenuGroups(pcRoutes, userStore.hasPerm))
const activeMenu = computed(() => route.path)

// 面包屑：模块名 + 页面名
const breadcrumbs = computed(() => {
  const items = []
  if (route.meta?.module) {
    items.push(route.meta.module)
  }
  if (route.meta?.title) {
    items.push(route.meta.title)
  }
  return items
})

const keyword = ref('')
// 窄屏断点：与 variables.scss 的 $breakpoint-md 保持一致
const NARROW_QUERY = '(max-width: 768px)'
const isNarrow = ref(false)
const drawerOpen = ref(false)
// 移动端入口弹窗显隐（二维码 + 移动端页面链接）
const mobileEntryOpen = ref(false)
let mediaQuery = null

/** 折叠按钮文案：窄屏是「菜单」（开抽屉），宽屏是「收起/展开」侧栏 */
const sidebarToggleText = computed(() => {
  if (isNarrow.value) {
    return '菜单'
  }
  return appStore.sidebarCollapsed ? '展开' : '收起'
})

/**
 * 断点变化回调：进入窄屏时侧栏改由抽屉承载。
 * @param {MediaQueryListEvent} event matchMedia 事件
 */
function handleMediaChange(event) {
  isNarrow.value = event.matches
  // 从窄屏切回宽屏要收起抽屉，避免遮罩层残留在页面上
  if (!event.matches) {
    drawerOpen.value = false
  }
}

/** 折叠按钮：窄屏开关抽屉，宽屏走原有的侧栏折叠 */
function handleSidebarToggle() {
  if (isNarrow.value) {
    drawerOpen.value = !drawerOpen.value
    return
  }
  appStore.toggleSidebar()
}

function handleKeywordSearch() {
  // 骨架阶段：按关键词跳转设备总览，后续替换为全局搜索面板
  if (keyword.value.trim()) {
    router.push({ path: '/iot/devices', query: { keyword: keyword.value.trim() } })
  }
}

/** 退出登录：清令牌 + 清 store，再跳登录页 */
async function handleLogout() {
  userStore.logout()
  drawerOpen.value = false
  await router.push('/login')
}

function handleCommand(command) {
  if (command === 'logout') {
    handleLogout()
  } else if (command === 'profile') {
    drawerOpen.value = false
    // 自助页：每个角色都能看自己的资料，不再跳管理员专属的 /system/users
    router.push('/profile')
  }
}

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia(NARROW_QUERY)
    isNarrow.value = mediaQuery.matches
    mediaQuery.addEventListener('change', handleMediaChange)
  }
  // 刷新页面时 store 里只有 token（localStorage 持久化），档案必须补拉一次 A02，
  // 否则顶栏、按钮权限拿到的都是空档案，表现为一直显示「未登录」
  if (userStore.isLogin && !userStore.userInfo) {
    userStore.fetchProfile()
  }
})

onBeforeUnmount(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', handleMediaChange)
  }
})

// 路由切换后收起抽屉，避免点完菜单抽屉还盖在内容上
watch(
  () => route.fullPath,
  () => {
    drawerOpen.value = false
  }
)
</script>

<template>
  <el-container class="layout">
    <!-- 宽屏侧栏：窄屏下由下面的抽屉替代，避免固定 232px 撑破视口 -->
    <el-aside
      v-if="!isNarrow"
      class="layout__aside"
      :width="appStore.sidebarCollapsed ? '64px' : '232px'"
    >
      <div class="layout__logo">
        <span class="layout__logo-mark">农</span>
        <span v-show="!appStore.sidebarCollapsed" class="layout__logo-text">智慧农业管理平台</span>
      </div>
      <el-scrollbar class="layout__menu-scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="appStore.sidebarCollapsed"
          :collapse-transition="false"
          background-color="#1f3a2e"
          text-color="#c8d6cf"
          active-text-color="#ffffff"
          router
          unique-opened
        >
          <el-sub-menu v-for="group in menuGroups" :key="group.title" :index="group.title">
            <template #title>
              <span class="layout__group-title">{{ group.title }}</span>
            </template>
            <el-menu-item v-for="item in group.items" :key="item.path" :index="item.path">
              <span class="layout__item-title">{{ item.title }}</span>
              <span class="layout__item-id">{{ item.pageId }}</span>
            </el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <!-- 窄屏抽屉：菜单数据与宽屏侧栏完全一致，只是换了承载容器 -->
    <el-drawer
      v-model="drawerOpen"
      class="layout__drawer"
      direction="ltr"
      size="232px"
      :with-header="false"
      body-class="layout__drawer-body"
    >
      <div class="layout__drawer-inner">
        <div class="layout__logo">
          <span class="layout__logo-mark">农</span>
          <span class="layout__logo-text">智慧农业管理平台</span>
        </div>
        <el-scrollbar class="layout__menu-scroll layout__menu-scroll--drawer">
          <el-menu
            :default-active="activeMenu"
            :collapse="false"
            :collapse-transition="false"
            background-color="#1f3a2e"
            text-color="#c8d6cf"
            active-text-color="#ffffff"
            router
            unique-opened
          >
            <el-sub-menu v-for="group in menuGroups" :key="group.title" :index="group.title">
              <template #title>
                <span class="layout__group-title">{{ group.title }}</span>
              </template>
              <el-menu-item v-for="item in group.items" :key="item.path" :index="item.path">
                <span class="layout__item-title">{{ item.title }}</span>
                <span class="layout__item-id">{{ item.pageId }}</span>
              </el-menu-item>
            </el-sub-menu>
          </el-menu>
        </el-scrollbar>
      </div>
    </el-drawer>

    <el-container class="layout__body">
      <el-header class="layout__header">
        <div class="layout__header-left">
          <el-button text class="layout__collapse" @click="handleSidebarToggle">
            {{ sidebarToggleText }}
          </el-button>
          <el-breadcrumb v-if="!isNarrow" separator="/">
            <el-breadcrumb-item v-for="crumb in breadcrumbs" :key="crumb">
              {{ crumb }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="layout__header-right">
          <el-input
            v-if="!isNarrow"
            v-model="keyword"
            class="layout__search"
            placeholder="搜索设备 / 地块 / 批次"
            clearable
            @keyup.enter="handleKeywordSearch"
          />
          <el-button text class="layout__mobile-entry" @click="mobileEntryOpen = true">
            移动端
          </el-button>
          <el-badge :value="alertStore.pendingCount" :hidden="alertStore.pendingCount === 0">
            <el-button text @click="router.push('/iot/alerts')">告警</el-button>
          </el-badge>
          <!-- 已登录：显示「姓名 · 角色名」+ 下拉；未登录才显示「未登录」 -->
          <el-dropdown
            v-if="userStore.isLogin"
            class="layout__user-dropdown"
            @command="handleCommand"
          >
            <span class="layout__user">
              <span class="layout__user-name">{{ userStore.userName }}</span>
              <span v-if="userStore.roleName" class="layout__user-role">
                · {{ userStore.roleName }}
              </span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人信息</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-else class="layout__user layout__user--guest">未登录</span>
        </div>
      </el-header>

      <el-main class="layout__main">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 移动端入口弹窗：teleport 到 body，放在容器末尾不影响布局 -->
    <AgriMobileEntry v-model="mobileEntryOpen" />
  </el-container>
</template>

<style scoped lang="scss">
.layout {
  height: 100vh;
}

.layout__body {
  min-width: 0;
}

.layout__aside {
  background-color: $bg-sidebar;
  transition: width 0.2s ease;
  overflow: hidden;
}

.layout__logo {
  display: flex;
  align-items: center;
  gap: $space-sm;
  height: $header-height;
  padding: 0 16px;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.layout__logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-weight: 700;
  color: $bg-sidebar;
  background-color: #a5d6a7;
  border-radius: $radius-sm;
}

.layout__logo-text {
  font-size: $font-size-base;
  font-weight: 600;
  white-space: nowrap;
}

.layout__menu-scroll {
  height: calc(100vh - #{$header-height});
}

// 抽屉内没有独立视口高度概念，交给 flex 撑满，滚动条只出现在菜单区域
.layout__menu-scroll--drawer {
  flex: 1;
  min-height: 0;
  height: auto;
}

.layout__drawer-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: $bg-sidebar;
}

.layout__group-title {
  font-size: $font-size-sm;
}

.layout__item-id {
  margin-left: $space-sm;
  font-size: $font-size-xs;
  color: rgba(200, 214, 207, 0.55);
  font-family: Consolas, Monaco, monospace;
}

.layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-md;
  height: $header-height;
  padding: 0 16px;
  background-color: #fff;
  border-bottom: 1px solid $border-color;
}

.layout__header-left,
.layout__header-right {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: $space-md;
}

.layout__header-right {
  flex-shrink: 0;
}

.layout__search {
  width: 220px;
}

// 与「告警」等顶栏文字按钮一致，窄屏也不许被挤压
.layout__mobile-entry {
  flex-shrink: 0;
}

.layout__user {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  font-size: $font-size-base;
  color: $text-primary;
  white-space: nowrap;
}

.layout__user-role {
  font-size: $font-size-sm;
  color: $text-secondary;
}

.layout__user--guest {
  cursor: default;
  color: $text-secondary;
}

.layout__main {
  padding: 0;
  background-color: $bg-page;
  overflow-y: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 992px) {
  .layout__search {
    display: none;
  }
}

@media (max-width: 768px) {
  .layout__header {
    padding: 0 8px;
  }

  .layout__header-left,
  .layout__header-right {
    gap: $space-sm;
  }
}
</style>

<style lang="scss">
/**
 * 抽屉是 teleport 到 body 的，scoped 样式够不到它内部节点，
 * 这里用全局类名清掉 el-drawer 默认的 20px 内边距，让侧栏底色铺满抽屉。
 */
.el-drawer .layout__drawer-body {
  padding: 0;
  background-color: $bg-sidebar;
}
</style>
