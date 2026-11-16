<script setup>
/**
 * 移动端布局
 * 结构：顶部标题栏 + 内容区 + 底部 tab（工作台 / 打卡 / 溯源查询）。
 * PC 浏览器访问时内容区居中限宽，方便在电脑上预览移动端页面。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

defineOptions({ name: 'MobileLayout' })

const route = useRoute()
const router = useRouter()

const tabs = [
  { path: '/m/home', label: '工作台' },
  { path: '/m/checkin', label: '打卡' },
  { path: '/trace/scan', label: '溯源' }
]

const activeTab = computed(() => route.path)
const pageTitle = computed(() => route.meta?.title || '智慧农业移动端')

function handleTabChange(path) {
  if (path !== route.path) {
    router.push(path)
  }
}
</script>

<template>
  <div class="m-layout">
    <header class="m-layout__header">
      <span class="m-layout__title">{{ pageTitle }}</span>
      <span class="m-layout__badge">{{ route.meta?.pageId || '' }}</span>
    </header>

    <main class="m-layout__body">
      <router-view />
    </main>

    <nav class="m-layout__tabbar">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        type="button"
        class="m-layout__tab"
        :class="{ 'is-active': activeTab === tab.path }"
        @click="handleTabChange(tab.path)"
      >
        {{ tab.label }}
      </button>
    </nav>
  </div>
</template>

<style scoped lang="scss">
.m-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 640px;
  margin: 0 auto;
  background-color: $bg-page;
  box-shadow: 0 0 24px rgba(31, 45, 61, 0.06);
}

.m-layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: $header-height;
  padding: 0 16px;
  color: #fff;
  background-color: $primary-color;
}

.m-layout__title {
  font-size: $font-size-md;
  font-weight: 600;
}

.m-layout__badge {
  font-size: $font-size-xs;
  font-family: Consolas, Monaco, monospace;
  opacity: 0.8;
}

.m-layout__body {
  flex: 1;
  overflow-y: auto;
}

.m-layout__tabbar {
  display: flex;
  height: $mobile-tabbar-height;
  background-color: #fff;
  border-top: 1px solid $border-color;
}

.m-layout__tab {
  flex: 1;
  font-size: $font-size-sm;
  color: $text-secondary;
  background: none;
  border: none;
  cursor: pointer;
}

.m-layout__tab.is-active {
  color: $primary-color;
  font-weight: 600;
}
</style>
