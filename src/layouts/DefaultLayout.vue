<script setup>
/**
 * PC 端默认布局
 * 结构：左侧模块化侧边菜单 + 顶部栏（折叠按钮 / 面包屑 / 用户信息）+ 内容区 router-view。
 * 菜单数据由 router/index.js 的 pcRoutes 聚合生成，新增页面只需加路由模块，无需改本文件。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/store/modules/app'
import { useUserStore } from '@/store/modules/user'
import { useAlertStore } from '@/store/modules/alert'
import { pcRoutes } from '@/router'
import buildMenuGroups from '@/router/menu'

defineOptions({ name: 'DefaultLayout' })

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const userStore = useUserStore()
const alertStore = useAlertStore()

const menuGroups = buildMenuGroups(pcRoutes)
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

function handleKeywordSearch() {
  // 骨架阶段：按关键词跳转设备总览，后续替换为全局搜索面板
  if (keyword.value.trim()) {
    router.push({ path: '/iot/devices', query: { keyword: keyword.value.trim() } })
  }
}

function handleLogout() {
  userStore.logout()
  router.push('/login')
}

function handleCommand(command) {
  if (command === 'logout') {
    handleLogout()
  } else if (command === 'profile') {
    router.push('/system/users')
  }
}
</script>

<template>
  <el-container class="layout">
    <el-aside class="layout__aside" :width="appStore.sidebarCollapsed ? '64px' : '232px'">
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

    <el-container>
      <el-header class="layout__header">
        <div class="layout__header-left">
          <el-button text class="layout__collapse" @click="appStore.toggleSidebar()">
            {{ appStore.sidebarCollapsed ? '展开' : '收起' }}
          </el-button>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="crumb in breadcrumbs" :key="crumb">
              {{ crumb }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="layout__header-right">
          <el-input
            v-model="keyword"
            class="layout__search"
            placeholder="搜索设备 / 地块 / 批次"
            clearable
            @keyup.enter="handleKeywordSearch"
          />
          <el-badge :value="alertStore.pendingCount" :hidden="alertStore.pendingCount === 0">
            <el-button text @click="router.push('/iot/alerts')">告警</el-button>
          </el-badge>
          <el-dropdown @command="handleCommand">
            <span class="layout__user">{{ userStore.userName }}</span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人信息</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
  </el-container>
</template>

<style scoped lang="scss">
.layout {
  height: 100vh;
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
  height: $header-height;
  padding: 0 16px;
  background-color: #fff;
  border-bottom: 1px solid $border-color;
}

.layout__header-left,
.layout__header-right {
  display: flex;
  align-items: center;
  gap: $space-md;
}

.layout__search {
  width: 220px;
}

.layout__user {
  cursor: pointer;
  font-size: $font-size-base;
  color: $text-primary;
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
</style>
