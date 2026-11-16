<script setup>
/**
 * 根组件：通过 el-config-provider 提供 Element Plus 中文语言包，并承载路由出口。
 * 布局由各路由的父级 layout 组件决定。
 */
import zhCn from 'element-plus/es/locale/lang/zh-cn'

defineOptions({ name: 'AppRoot' })
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<style>
#app {
  height: 100%;
}
</style>
