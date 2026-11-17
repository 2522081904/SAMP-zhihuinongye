/**
 * Vite 构建配置（Vite 6 + Vue 3）
 * 职责：路径别名、开发服务器与接口代理、Element Plus 按需引入、生产构建分包。
 */
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 代理目标：优先使用 .env 中的 VITE_PROXY_TARGET，缺省回落到本地后端占位地址
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080'
  // 部署基路径：GitHub Pages 项目站点挂在 /<repo>/ 下，构建时用 VITE_BASE 注入；
  // 本地开发与 `npm run build` 不带该变量，回落到根路径 /
  const base = process.env.VITE_BASE || '/'

  return {
    base,
    plugins: [
      vue(),
      // 自动导入 vue / vue-router / pinia 的组合式 API，减少样板 import
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia'],
        dts: false,
        eslintrc: { enabled: false }
      }),
      // 组件按需注册：模板里直接写 <el-button> 即可，样式随组件自动引入
      Components({
        resolvers: [ElementPlusResolver()],
        dts: false
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {
          // 全局注入变量与断点，页面样式里可直接使用 $primary-color 等
          additionalData: `@use "@/assets/styles/variables.scss" as *;`
        }
      }
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        // 开发期把 /api 转发到后端，避免跨域
        '/api': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          /**
           * 分包策略（函数形式，不能用对象字面量）：
           * echarts + zrender 体积大且被多个图表页复用，必须独立成 chunk，
           * 否则 Rollup 会把它并进第一个引用它的页面 chunk（EnvMonitor 曾因此涨到 648 kB）。
           * element-plus 与 vue 系框架同样按包拆分，便于浏览器长期缓存。
           * @param {string} id 模块绝对路径
           * @returns {string|undefined} chunk 名称，返回 undefined 交回 Rollup 默认策略
           */
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (!normalized.includes('/node_modules/')) {
              return undefined
            }
            if (/\/(echarts|zrender)\//.test(normalized)) {
              return 'echarts'
            }
            if (/\/(element-plus|@element-plus)\//.test(normalized)) {
              return 'element-plus'
            }
            if (/\/(vue|@vue|vue-router|pinia)\//.test(normalized)) {
              return 'vendor'
            }
            return undefined
          }
        }
      }
    }
  }
})
