/**
 * Element Plus「命令式组件」样式补齐
 *
 * 背景：本项目用 unplugin-vue-components 的 ElementPlusResolver() 按需注入样式，
 * 该机制只扫描模板里的组件标签（含 v-loading 这类指令）。ElMessageBox / ElMessage
 * 这种通过 JS 直接调用 API 弹出的组件不出现在任何模板里，因此拿不到对应 CSS，
 * 表现是弹层没有 position / z-index / 遮罩，退化成普通流式元素堆到页面左上角
 * （历史 bug：/system/users 的启停与重置密码二次确认框错位到左上角）。
 *
 * 用法：在应用入口最早期 import 一次即可（见 src/main.js）。
 * 同一 CSS 模块无论被 import 多少次，打包产物里只有一份，因此与
 * src/api/request.js 里已有的 message 样式导入并存不会重复打包。
 * 后续新增命令式组件调用时，在这里补一行 import，避免同类问题复发。
 */

// ElMessage —— 顶部轻提示。
// request.js 请求层也单独 import 过一次：那是请求层的独立依赖，不能因为这里有了就删掉。
import 'element-plus/es/components/message/style/css'
// ElMessageBox —— 二次确认框 / 输入框，本项目 6 个页面在用（本次 bug 的根因）
import 'element-plus/es/components/message-box/style/css'
// ElLoading —— v-loading 指令的遮罩。指令已由 ElementPlusResolver 覆盖，此处显式声明
// 只为让「命令式/指令类组件」的样式依赖集中在一处，体积不增加（幂等）。
import 'element-plus/es/components/loading/style/css'

// ElNotification —— 当前全项目未使用，故不引入（引入会多约 3.4 kB CSS）。
// 将来若调用 ElNotification.xxx()，在此补：
// import 'element-plus/es/components/notification/style/css'
