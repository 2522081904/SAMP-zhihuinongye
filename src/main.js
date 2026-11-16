/**
 * 应用入口
 * 职责：创建 Vue 应用，挂载 Pinia、Router、全局指令与全局样式。
 * Element Plus 组件与样式由 unplugin-vue-components 按需注入，入口不整包引入。
 */
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import pinia from './store'
import permission from './directives/permission'
import '@/assets/styles/index.scss'

const app = createApp(App)

app.use(pinia)
app.use(router)
app.directive('perm', permission)

app.mount('#app')
