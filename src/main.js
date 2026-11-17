/**
 * 应用入口
 * 职责：创建 Vue 应用，挂载 Pinia、Router、全局指令与全局样式。
 * Element Plus 组件与样式由 unplugin-vue-components 按需注入，入口不整包引入。
 * 开发环境下按 VITE_USE_MOCK 开关动态装载本地假数据层（生产构建不引入 mock 代码）。
 */
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import pinia from './store'
import request from '@/api/request'
import permission from './directives/permission'
import '@/assets/styles/index.scss'

const app = createApp(App)

app.use(pinia)
app.use(router)
app.directive('perm', permission)

/**
 * 启动应用：先按需安装 mock adapter，再挂载根组件，保证首屏请求也能命中假数据。
 * @returns {Promise<void>} 启动完成
 */
async function bootstrap() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { installMock } = await import('@/mock/index.js')
    installMock(request)
  }
  app.mount('#app')
}

bootstrap()
