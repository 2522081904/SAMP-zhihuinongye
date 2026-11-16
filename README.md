# 智慧农业综合管理平台（V1）前端工程

Vite 6 + Vue 3 前端骨架工程，对应实训模块 2「项目架构设计与工程初始化」。
本阶段完成工程规范、目录结构、33 个页面的路由与占位骨架，业务逻辑留待后续模块实现。

## 技术栈

| 分类     | 选型                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 构建工具 | Vite 6                                                                        |
| 框架     | Vue 3（组合式 API，`<script setup>`，JS + JSDoc，不使用 TypeScript）          |
| 路由     | vue-router 4（history 模式）                                                  |
| 状态管理 | Pinia 2                                                                       |
| 组件库   | Element Plus 2（`unplugin-vue-components` + `unplugin-auto-import` 按需引入） |
| 样式     | Sass（`sass`），SCSS 变量通过 Vite 全局注入                                   |
| 请求     | axios 1                                                                       |
| 代码规范 | ESLint 9（flat config）+ eslint-plugin-vue + Prettier 3                       |

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器，默认 http://127.0.0.1:5173
npm run build        # 生产构建，产物输出到 dist/
npm run preview      # 本地预览构建产物
npm run lint         # ESLint 检查（--max-warnings 0，不允许 warning）
npm run format       # Prettier 格式化全部文件
npm run format:check # Prettier 校验（不修改文件）
```

## 目录结构

```
agri-web/
├─ .env.development        # 开发环境变量（接口前缀 / 上传地址 / mock 开关 / 代理目标）
├─ .env.production         # 生产环境变量
├─ .editorconfig           # 编辑器统一：utf-8 / LF / 2 空格 / 去尾空格
├─ .prettierrc.json        # Prettier 规则
├─ eslint.config.js        # ESLint 9 flat config
├─ jsconfig.json           # @ 指向 src 的编辑器路径提示
├─ index.html              # 单页入口，挂载点 #app
├─ vite.config.js          # 别名 / 代理 / 按需引入 / 分包
├─ public/favicon.svg
└─ src/
   ├─ main.js              # 应用入口：挂载 Pinia、Router、全局指令与样式
   ├─ App.vue              # 根组件：Element Plus 中文语言包 + 路由出口
   ├─ api/                 # 接口层
   │  ├─ request.js        # axios 实例与统一响应拦截
   │  └─ modules/          # 按业务域拆分的接口函数（auth/iot/farm/trace/alert/system/commerce/analysis/gis）
   ├─ assets/styles/       # variables.scss / reset.scss / index.scss
   ├─ components/          # 通用组件：AgriPageHeader / AgriTable / AgriEmpty / AgriChart
   ├─ composables/         # usePagination / useTable
   ├─ directives/          # permission.js：v-perm 按钮级权限
   ├─ layouts/             # DefaultLayout（PC 侧边菜单 + 顶栏）/ MobileLayout（底部 tab）
   ├─ router/              # index.js 总装 + menu.js 菜单生成 + modules/ 按模块拆分路由
   ├─ store/               # index.js（createPinia）+ modules/（app/user/iot/farm/alert）
   ├─ views/               # PC 管理端页面（P001–P030）+ NotFound.vue / Forbidden.vue 错误页
   └─ views-m/             # 移动端与消费者端页面（M001–M003）
```

## 路由与页面约定

- PC 页面统一挂 `DefaultLayout`，移动端页面挂 `MobileLayout`，`/login` 独立无布局。
- 每条路由的 `meta` 携带 `{ title, pageId, module }`，`router.beforeEach` 用它设置 `document.title`。
- 侧边菜单由 `src/router/modules/*.js` 的 PC 路由按 `meta.module` 自动聚合（`src/router/menu.js`），新增页面只需新增路由，不必改菜单。
- 模块名以页面清单为准，共 9 个 PC 模块（`登录与鉴权` 只有 P001，走独立布局、不进菜单）：
  `物联网感知监测`（P002–P006、P013）→ `远程智能控制`（P007–P009）→ `数据中心与AI分析`（P010–P012）→ `GIS地理信息`（P014、P024）→ `生产农事管理`（P015–P020）→ `质量安全溯源`（P021–P023）→ `告警消息中心`（P025、P026）→ `产销对接与订单`（P027、P028）→ `系统后台管理`（P029、P030）。
- 菜单实测为 9 个分组、29 个菜单项；分组顺序在 `src/router/menu.js` 的 `MODULE_ORDER` 中固定，组内按页面编号排序。
- `/` 重定向到 `/iot/env`，未匹配路径落到 `src/views/NotFound.vue`。

| 编号 | 页面                     | 路由                     | 所属模块         |
| ---- | ------------------------ | ------------------------ | ---------------- |
| P001 | 登录页                   | `/login`                 | 登录与鉴权       |
| P002 | 环境数据监测页           | `/iot/env`               | 物联网感知监测   |
| P003 | 设备详情页               | `/iot/devices/detail`    | 物联网感知监测   |
| P004 | 历史数据与趋势分析页     | `/iot/history`           | 物联网感知监测   |
| P005 | 设备总览页               | `/iot/devices`           | 物联网感知监测   |
| P006 | 设备巡检与离线排查页     | `/iot/patrol`            | 物联网感知监测   |
| P007 | 远程控制页               | `/iot/control`           | 远程智能控制     |
| P008 | 策略联动配置页           | `/iot/strategy`          | 远程智能控制     |
| P009 | 控制日志页               | `/iot/control/log`       | 远程智能控制     |
| P010 | 数据分析总览页           | `/analysis/overview`     | 数据中心与AI分析 |
| P011 | 报表中心页               | `/reports`               | 数据中心与AI分析 |
| P012 | 长势与病虫害识别页       | `/analysis/ai`           | 数据中心与AI分析 |
| P013 | 视频监控页               | `/iot/video`             | 物联网感知监测   |
| P014 | GIS 地图总览与地块绘制页 | `/gis/map`               | GIS地理信息      |
| P015 | 农事计划管理页           | `/farm/plans`            | 生产农事管理     |
| P016 | 农事工单与打卡审核页     | `/farm/tasks`            | 生产农事管理     |
| P017 | 农资档案与领用申请页     | `/farm/inputs`           | 生产农事管理     |
| P018 | 农资出库与投入品台账页   | `/farm/inputs/ledger`    | 生产农事管理     |
| P019 | 库存与低库存预警页       | `/farm/inputs/inventory` | 生产农事管理     |
| P020 | 采收批次登记页           | `/farm/harvest`          | 生产农事管理     |
| P021 | 溯源批次与二维码生成页   | `/trace/batches`         | 质量安全溯源     |
| P022 | 溯源信息编辑与扫码预览页 | `/trace/edit`            | 质量安全溯源     |
| P023 | 检测报告与送检管理页     | `/trace/lab`             | 质量安全溯源     |
| P024 | GIS 空间统计与图层管理页 | `/gis/stats`             | GIS地理信息      |
| P025 | 告警列表页               | `/iot/alerts`            | 告警消息中心     |
| P026 | 告警处置与统计分析页     | `/iot/alerts/handle`     | 告警消息中心     |
| P027 | 订单管理页               | `/commerce/orders`       | 产销对接与订单   |
| P028 | 商品与客户档案页         | `/commerce/products`     | 产销对接与订单   |
| P029 | 用户与角色管理页         | `/system/users`          | 系统后台管理     |
| P030 | 权限配置与接口对接页     | `/system/perm`           | 系统后台管理     |
| M001 | 移动端工作台             | `/m/home`                | 农户移动端       |
| M002 | 农事打卡上传页           | `/m/checkin`             | 农户移动端       |
| M003 | 扫码溯源查询页           | `/trace/scan`            | 质量安全溯源     |

## 403 与权限

- 权限集合存在 `src/store/modules/user.js` 的 `profile.permissions` 中，骨架阶段 mock 用户带通配符 `'*'`（全量权限），因此菜单不会被过滤掉。
- `userStore.hasPerm(code)` 是唯一的权限判断入口：集合含 `'*'` 时一律放行，否则按权限码精确匹配。
- 路由级拦截：`src/router/index.js` 的 `beforeEach` 检查 `to.meta.perm`，无权限时跳转 `{ path: '/403', query: { from: to.fullPath } }`。骨架阶段还没有路由声明 `meta.perm`，所以默认全部放行；给敏感路由加上 `meta: { perm: 'system:user:list' }` 即自动生效。
- 按钮级拦截：`v-perm="'iot:control'"` 指令（`src/directives/permission.js`）在无权限时移除元素。
- `/403` 页面为 `src/views/Forbidden.vue`，`meta.menu: false` 不进菜单，页面提供「返回工作台」按钮；它属于错误页，不计入 33 个业务页面。

## 接口与鉴权约定

- `src/api/request.js` 统一 baseURL 为 `VITE_API_BASE_URL`（开发期 `/api/v1`），请求头自动带 `Authorization: Bearer <token>`，token 存于 `localStorage` 的 `agri_token`。
- 后端统一响应体为 `{ code, message, data, requestId, timestamp }`：`code === 0` 时拦截器直接返回 `data`；非 0 时用 `ElMessage.error` 提示并 `reject`；`code === 40101`（登录态失效）清除 token 并跳转 `/login`。
- 开发期 `/api` 由 Vite 代理到 `VITE_PROXY_TARGET`（默认 `http://127.0.0.1:8080`），用于对接后端联调。

## 构建产物

`npm run build` 输出到 `dist/`，其中 `vendor` chunk 收纳 vue / vue-router / pinia，`element-plus` chunk 单独拆出，页面代码按路由懒加载分片，便于浏览器长期缓存。
