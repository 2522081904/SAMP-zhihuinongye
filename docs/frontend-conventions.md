# 前端开发约定（agri-web）

> 本文件约束 `agri-web` 后续所有业务页面的数据接入与组件用法。
> 接口以 `weekwork/spec_contract.md` 的 A01–A26 为唯一权威，本文只解释落地方式，不新增接口。

## 1. 目录分层与职责

```
src/
├── api/
│   ├── request.js          # axios 实例：baseURL、Bearer 注入、信封解包、40101 跳登录
│   ├── request-id.js       # 写接口幂等号：createRequestId() / writeConfig()
│   ├── index.js            # 统一出口：页面只从 '@/api' 导入
│   └── modules/            # 按 A 编号分组的具名函数（13 个文件）
├── mock/                   # 假数据层，仅开发环境启用
│   ├── db.js               # 确定性内存种子数据 + 查询函数
│   ├── utils.js            # 信封/分页/时间/路径匹配等纯函数
│   ├── handlers/           # 按模块拆分的 (config) => envelope
│   ├── adapter.js          # 自写 axios adapter，按 method + url 分发
│   └── index.js            # installMock(axiosInstance)，受 VITE_USE_MOCK 控制
├── components/             # 跨页面通用组件（Agri* 前缀）
├── composables/            # 组合式函数（分页、表格、轮询等）
├── views/                  # PC 端业务页，一个路由页一个文件
├── views-m/                # 移动端业务页
├── router/                 # 路由与守卫（本轮未改）
└── store/                  # Pinia，用户态与权限
```

职责边界：

- **页面**只做「取数 + 组装 + 交互」，不写裸 URL、不手拼信封、不判断 HTTP 状态码。
- **api/modules** 只做「路径 + 参数 + 请求方式」的映射，不做业务判断、不弹提示。
- **mock** 只模拟后端行为，不承载业务规则；开关关闭后页面代码零改动即可打真接口。
- **components** 不直接调接口，数据与事件全部由页面传入。

## 2. 命名规则

| 对象          | 规则                                                                                 | 示例                                            |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| api 函数      | 动词开头 + 业务名，列表用 `fetch*`，新建用 `create*`，改动用 `update*`，动作类用动词 | `fetchDevices`、`createFarmPlan`、`handleAlarm` |
| 路由/页面文件 | 小写中划线                                                                           | `device-list.vue`、`trace-archive.vue`          |
| 组件          | PascalCase，通用组件 `Agri` 前缀                                                     | `AgriTable.vue`、`AgriSearchBar.vue`            |
| 组合式函数    | `use` 前缀                                                                           | `useTable`、`usePagination`                     |
| 常量          | 大写下划线                                                                           | `TOKEN_KEY`、`DEFAULT_PAGE_SIZE`                |
| 事件          | kebab-case，动词过去式或名词                                                         | `@search`、`@page-change`、`@submit`            |
| 接口注释      | 函数上方一行：`A编号 中文名 · 使用页面`                                              | `/** A03 设备台账查询 · P003/P006 */`           |

接口编号（A01–A26）与页面编号（P001–P030、M001–M003）必须写进 api 函数注释，方便反查契约。

## 3. 接口调用约定

### 3.1 导入方式

```js
import { fetchDevices, handleAlarm } from '@/api'
```

页面禁止出现 `/iot/devices` 这类裸路径；新增接口时先补 `src/api/modules/*.js`，再补 `src/api/index.js` 的汇总导出（当前为 `export *`，通常无需改动）。

### 3.2 返回值

`request.js` 的响应拦截器已经做了信封解包：

- 成功（`code === 0`）：Promise resolve 的是 **`data` 本体**，不是整个信封。分页接口拿到的就是 `{ page, size, total, list }`。
- 失败（`code !== 0`）：统一 `ElMessage.error(message)` 后 reject，页面只需 `try/finally` 关 loading，不必重复弹错。
- 网络/HTTP 错误：由拦截器转成中文提示后 reject。

因此页面写法固定为：

```js
loading.value = true
try {
  const { list, total } = await fetchDevices({ page: 1, size: 10 })
  rows.value = list
  total.value = total
} finally {
  loading.value = false
}
```

### 3.3 错误码与提示文案

| code  | 含义                             | 前端处理                                                                              |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------- |
| 0     | 成功                             | resolve data                                                                          |
| 40001 | 参数校验失败                     | 拦截器已弹 `message`；表单场景可同时把字段标红                                        |
| 40101 | 未登录 / 凭证失效                | 拦截器清 token → 跳 `${BASE_URL}login`，页面不要自行跳转                              |
| 40102 | 账号或密码错误                   | 登录页展示「账号或密码错误，请重试」                                                  |
| 40301 | 无权限                           | 提示「当前账号无此操作权限，请联系管理员」，按钮层应先用 `hasPerm` 隐藏               |
| 40401 | 资源不存在                       | 详情页进入空态 / 返回列表，不弹全局错误                                               |
| 40901 | 状态冲突（重复提交、状态不允许） | 提示后端 message，例如「该计划已派单，请勿重复操作」；写接口必须带新的 `X-Request-Id` |
| 42301 | 安全锁开启 / 账号锁定            | 提示「安全锁已开启，请先在远程控制页解锁」或「账号已锁定，请联系管理员」              |
| 42901 | 限流                             | 提示「操作过于频繁，请稍后再试」，按钮加 3s 防抖                                      |
| 50001 | 服务内部异常                     | 提示「服务暂时不可用，请稍后重试」，保留重试入口                                      |

约定：`40101`、`40301`、`40901`、`42301` 的最终文案以 `message` 为准，前端不硬编码后端文案；只有兜底提示才用上表文字。

### 3.4 写接口与幂等

所有 POST/PUT/DELETE 统一带请求号：

```js
import { sendCommand, writeConfig } from '@/api'
await sendCommand({ deviceCode: 'EQ-1T-0001', action: 'ON' }, writeConfig())
```

`writeConfig()` 生成 `X-Request-Id`（`REQ-<base36>-<random>`）。同一业务动作重试时必须换新号；只有「用户重复点击同一动作」才复用，以便后端用 40901 拦重复。按钮层同时要做 loading 禁用，双保险。

### 3.5 登录与权限

- token 存 `localStorage` 的 `agri_token`（`TOKEN_KEY`），请求拦截器自动加 `Authorization: Bearer <token>`。
- 菜单与按钮权限来自 A02 返回的 `permissions`/`perms`；管理员为 `['*']`，`hasPerm('iot:command')` 对 `'*'` 恒真。
- A02 的 `menus` 是 9 个分组，分组下字段名是 `items: [{ path, title, pageId }]`，不是 el-menu 的 `children`，侧边栏渲染前需做一次映射。
- 本轮 `store/modules/user.js` 仍是本地 mock 登录，**下一轮**再接 `login()` / `fetchCurrentUser()`；页面不要直接读写 localStorage。

## 4. 分页参数口径

**接口层唯一口径（契约规定）：**

- 请求：`page` 从 **1** 开始，`size` 默认 **10**、上限 **100**；其余过滤条件平铺。
- 响应：`data = { page, size, total, list }`，`total` 是**过滤后**总数；页码越界返回空 `list`，不报错。

**已统一（本轮完成）：** `usePagination` 的内部字段与 `query` 均输出 `{ page, size }`，`useTable.loadData` 直接透传，`AgriTable` 的分页 props 为 `page/size/total/pageSizes`，全仓不再有 `pageNum/pageSize` 字段。新增页面直接用 composable 的 `pagination` 绑定表格即可。

其他约定：

- 切换 `size` 时页码重置为 1；搜索/重置也重置为 1。
- 列表页默认 `size=10`；大屏、导出场景可到 100，不要超过 100。
- 前端不要自己截断 `list`，越界由后端返回空数组。

## 5. 时间与数值格式

- 日期时间：`yyyy-MM-dd HH:mm:ss`（如 `2026-11-16 18:30:00`），全链路东八区，不带时区后缀。
- 日期：`yyyy-MM-dd`（如 `2026-11-16`），用于采收日期、施药日期等。
- 时间范围参数：`from` / `to` 使用上述完整格式；闭区间，前端传值前补齐时分秒。
- 数值展示：温度/湿度保留 1 位小数，金额保留 2 位小数并加千分位；单位放表头或后缀，不混进数值字段。
- 空值统一显示 `-`，不要显示 `null`/`undefined`/`NaN`。
- mock 的「当前时间」固定为 `2026-11-16 18:30:00`，页面上的相对时间（如「3 分钟前」）请基于接口返回时间计算，不要用 `Date.now()` 硬比。

## 6. Mock 开关与联调

- `.env.development`：`VITE_USE_MOCK=true` → `src/main.js` 在挂载前动态 `import('@/mock/index.js')` 并调用 `installMock(request)`。
- `.env.production`：`VITE_USE_MOCK=false` → 动态 import 分支不会执行，Rollup 不把 mock 打进主包（构建后 `dist` 中搜不到种子数据）。
- 关闭 mock：把 `.env.development` 的 `VITE_USE_MOCK` 改为 `false`，请求走 `VITE_API_BASE_URL`（开发环境再由 Vite 代理到 `VITE_PROXY_TARGET`）。
- mock 延迟 120–400ms，页面必须有 loading 态；不要写「请求太快所以不显示 loading」。
- mock 数据是确定性种子，刷新页面数据一致；写操作只改内存，刷新即还原（`resetRuntime()` 可手动重置）。
- 给某个接口加 mock 的步骤：`db.js` 补种子 → 对应 `handlers/*.js` 加分支 → `scripts/mock-smoke.mjs` 补用例。

## 7. 通用组件规划（下一轮）

现有 `AgriTable.vue`、`AgriChart.vue` 是骨架版（表格无分页、图表只画占位），本轮不改；下一轮在其上扩展，保持既有 props 兼容。

### 7.1 AgriTable（扩展）

职责：列配置渲染、loading、空态、分页条、列插槽，不负责取数。

| prop                | 类型    | 默认                | 说明                                                              |
| ------------------- | ------- | ------------------- | ----------------------------------------------------------------- |
| columns             | Array   | `[]`                | `{ prop, label, width, minWidth, align, formatter, fixed, slot }` |
| data                | Array   | `[]`                | 当前页数据                                                        |
| loading             | Boolean | `false`             | 表格 loading                                                      |
| rowKey              | String  | `'id'`              | 行主键                                                            |
| emptyText           | String  | `'暂无数据'`        | 空态文案                                                          |
| page / size / total | Number  | `1 / 10 / 0`        | 分页三件套（与接口口径一致）                                      |
| showPagination      | Boolean | `true`              | 是否显示分页条                                                    |
| pageSizes           | Array   | `[10, 20, 50, 100]` | 每页条数选项                                                      |

事件：`update:page`、`update:size`、`page-change({page,size})`、`selection-change(rows)`。
插槽：`toolbar`（表格上方操作区）、按 `column.prop` 命名的单元格插槽、`footer`。

### 7.2 AgriSearchBar（新增）

职责：查询条件表单 + 查询/重置按钮，条件由配置驱动。

| prop       | 类型    | 默认    | 说明                                                                                                   |
| ---------- | ------- | ------- | ------------------------------------------------------------------------------------------------------ |
| fields     | Array   | `[]`    | `{ prop, label, type: 'input'\|'select'\|'date'\|'daterange'\|'number', options, placeholder, width }` |
| modelValue | Object  | `{}`    | 查询条件对象（`v-model`）                                                                              |
| loading    | Boolean | `false` | 查询按钮 loading                                                                                       |
| inline     | Boolean | `true`  | 是否行内布局                                                                                           |
| showReset  | Boolean | `true`  | 是否显示重置                                                                                           |

事件：`update:modelValue`、`search`、`reset`。回车触发 `search`；`daterange` 输出 `[from, to]` 两个完整时间串。

### 7.3 AgriFormDialog（新增）

职责：弹窗表单容器，统一标题、宽度、校验、提交 loading、取消/确定。

| prop                     | 类型    | 默认              | 说明                                                       |
| ------------------------ | ------- | ----------------- | ---------------------------------------------------------- |
| modelValue               | Boolean | `false`           | 显隐（`v-model`）                                          |
| title                    | String  | `''`              | 弹窗标题                                                   |
| fields                   | Array   | `[]`              | `{ prop, label, type, options, rules, span, placeholder }` |
| model                    | Object  | `{}`              | 表单数据（`v-model:model` 或直接改传入对象）               |
| rules                    | Object  | `{}`              | Element Plus 校验规则                                      |
| width                    | String  | `'560px'`         | 弹窗宽度                                                   |
| loading                  | Boolean | `false`           | 提交按钮 loading                                           |
| confirmText / cancelText | String  | `'确定' / '取消'` | 按钮文案                                                   |

事件：`submit(form)`、`cancel`、`closed`。暴露 `validate()`、`resetFields()`。提交失败（40901 等）不自动关闭，保留用户输入。

### 7.4 AgriChart（扩展）

职责：echarts 实例生命周期、自适应、空态；页面只传 `option`。

| prop    | 类型    | 默认      | 说明                           |
| ------- | ------- | --------- | ------------------------------ |
| title   | String  | `''`      | 卡片标题                       |
| option  | Object  | `{}`      | echarts option（不含容器尺寸） |
| height  | String  | `'320px'` | 容器高度                       |
| loading | Boolean | `false`   | loading 遮罩                   |
| empty   | Boolean | `false`   | 无数据时显示空态而非空图       |
| theme   | String  | `''`      | 预留主题名                     |

要点：`onMounted` 初始化、`watch(option, ..., { deep: true })` 用 `setOption(option, true)`、`ResizeObserver` 响应容器变化、`onBeforeUnmount` 调 `dispose()`；`echarts` 按需引入（`echarts/core` + 图表/组件注册），不要全量 import，避免主包膨胀。

### 7.5 AgriStatCard（新增）

职责：工作台/大屏的指标卡。

| prop      | 类型             | 默认        | 说明                                                                |
| --------- | ---------------- | ----------- | ------------------------------------------------------------------- |
| label     | String           | `''`        | 指标名，如「今日平均温度」                                          |
| value     | Number \| String | `'-'`       | 指标值                                                              |
| unit      | String           | `''`        | 单位，如 `℃`、`%`                                                   |
| precision | Number           | `0`         | 小数位                                                              |
| trend     | Object           | `null`      | `{ value: 12.5, direction: 'up'\|'down'\|'flat', label: '较昨日' }` |
| icon      | String           | `''`        | 图标名（Element Plus 图标）                                         |
| color     | String           | `'primary'` | 主题色枚举，不传具体色值                                            |
| loading   | Boolean          | `false`     | 骨架屏                                                              |

事件：`click`。数值为空时显示 `-`，不要显示 0。

## 8. 本轮遗留与下一轮注意事项

1. ~~分页命名不一致~~（已在本轮统一为 `page/size`，见第 4 节）。
2. **路由 pageId 与契约 pageId 不一致**：两套编号口径并存（契约 P006=设备台账，工程 P006=设备巡检）。**UI 一律使用工程 pageId**，契约引用与工程页的逐条映射见 `docs/page-map.md`，不要改路由 pageId。
3. **A02 菜单按真实路由生成**：mock 的菜单 path 与现有 router 对齐；若改路由，需同步 `src/mock/db.js` 的 `menuGroups`。
4. **详情页 40401**：`request.js` 已对 40401 不弹全局提示，并在 reject 的 Error 上附带 `code/requestId`；页面 catch 到 40401 时直接进空态即可。
5. **图表数据形态**：A22 报表返回 `charts.trend/distribution/ranking`，其中 `trend` 是 `{ label, value }[]`，页面不要假设是 `[x, y]` 二元组。
6. **写操作后的列表刷新**：mock 写接口会改内存，但页面需重新拉列表；不要乐观更新，否则与后端真实行为不一致。
7. **时间比较**：mock 固定「现在」，倒计时/相对时间请用接口返回的 `timestamp` 或数据时间，避免演示时出现「未来时间」。
