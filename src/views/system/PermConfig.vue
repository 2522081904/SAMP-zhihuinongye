<script setup>
/**
 * P030 权限配置与接口对接
 * 数据来源：A02 当前用户与菜单（GET /auth/me，取菜单分组）、
 *           A26 开放平台接入（GET /open/apps、POST /open/apps）。
 * 数据缺口与限制：
 * - A02 只返回菜单结构，没有权限编码与按钮级权限；本页的权限编码、按钮权限为前端常量，
 *   与 P029 角色权限树保持同一口径，接入真实权限中心后应改为后端下发；
 * - A01–A26 的接口清单、方法、路径、对接状态、最近调用时间为前端静态演示数据
 *   （来源 weekwork/spec_contract.md 的接口契约），没有「接口元数据」查询接口；
 * - A26 的 GET /open/apps 只返回 appId/appName/status 等字段，没有 AppKey 与联系人/用途，
 *   且 POST /open/apps 返回的 appId 形如 APP-2026-0004，并不是需求要求的 `app_` + 16 位十六进制；
 *   因此新建应用的 AppKey 由前端生成（Math.random），并连同状态、创建时间写 localStorage
 *   （agri-open-app-meta-v1）作为本地补充，刷新后仍能保留；
 * - A26 没有「重置密钥」「停用/启用」接口：这两类操作只更新本地补充记录并提示，不写后端；
 * - 所有写操作成功后都重新拉取 A26 列表（mock 返回 db 内对象引用，不能本地叠加）。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，最近调用时间均为该时间之前的静态值。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { createOpenApp, fetchOpenApps } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { MENU_PERMISSION_CODES, MODULE_BUTTONS } from '@/constants/permissions.js'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'SystemPermConfigPage' })

// 业务时间：mock 世界固定「现在」，导出文件名与演示时间戳都基于它
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_TODAY = BUSINESS_NOW_TEXT.slice(0, 10)
// 开放平台本地补充记录：A26 缺少 AppKey/联系人/用途字段，只能前端兜底
const OPEN_APP_META_KEY = 'agri-open-app-meta-v1'

const INTERFACE_STATUS_MAP = {
  CONNECTED: { text: '已对接', type: 'success' },
  JOINING: { text: '联调中', type: 'warning' },
  PENDING: { text: '未对接', type: 'info' }
}

const OPEN_APP_STATUS_MAP = {
  ENABLED: { text: '启用', type: 'success' },
  DISABLED: { text: '停用', type: 'info' }
}

// 菜单级 / 按钮级权限码统一来自共享常量，避免与 P029、A02 handler 各自维护一份而漂移

// A01–A26 接口清单（静态演示数据，来源接口契约 weekwork/spec_contract.md）
const API_LIST = [
  {
    code: 'A01',
    name: '账号登录',
    method: 'POST',
    path: '/auth/login',
    module: '认证',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 17:58:12'
  },
  {
    code: 'A02',
    name: '当前用户与菜单',
    method: 'GET',
    path: '/auth/me',
    module: '认证',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:02:45'
  },
  {
    code: 'A03',
    name: '设备台账',
    method: 'GET',
    path: '/iot/devices',
    module: '感知',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:12:03'
  },
  {
    code: 'A04',
    name: '下发控制指令',
    method: 'POST',
    path: '/ctl/commands',
    module: '控制',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:15:36'
  },
  {
    code: 'A05',
    name: '控制指令回执',
    method: 'GET',
    path: '/ctl/commands/{requestId}',
    module: '控制',
    status: 'PENDING',
    lastCallAt: ''
  },
  {
    code: 'A06',
    name: '实时环境数据',
    method: 'GET',
    path: '/iot/realtime',
    module: '感知',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:18:09'
  },
  {
    code: 'A07',
    name: '历史环境数据',
    method: 'GET',
    path: '/iot/history',
    module: '感知',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:03:27'
  },
  {
    code: 'A08',
    name: '智能控制策略',
    method: 'GET',
    path: '/ctl/strategies',
    module: '控制',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 17:46:51'
  },
  {
    code: 'A09',
    name: '控制操作日志',
    method: 'GET',
    path: '/ctl/logs',
    module: '控制',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:10:44'
  },
  {
    code: 'A10',
    name: '地块边界管理',
    method: 'POST/GET',
    path: '/gis/plots/{id}/boundary',
    module: 'GIS',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 16:55:18'
  },
  {
    code: 'A11',
    name: '农事计划',
    method: 'POST/GET',
    path: '/farm/plans',
    module: '生产',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 17:31:02'
  },
  {
    code: 'A12',
    name: '农事打卡记录',
    method: 'POST/GET',
    path: '/farm/records',
    module: '生产',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 17:39:48'
  },
  {
    code: 'A13',
    name: '农资出入库',
    method: 'POST/GET',
    path: '/supply/stock',
    module: '生产',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 16:28:35'
  },
  {
    code: 'A14',
    name: '投入品台账',
    method: 'POST/GET',
    path: '/supply/pesticide-logs',
    module: '生产',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 15:52:10'
  },
  {
    code: 'A15',
    name: '采收批次',
    method: 'POST/GET',
    path: '/harvest/batches',
    module: '生产',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 16:06:22'
  },
  {
    code: 'A16',
    name: '溯源码',
    method: 'POST/GET',
    path: '/trace/codes',
    module: '溯源',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 16:41:57'
  },
  {
    code: 'A17',
    name: '公开溯源查询',
    method: 'GET',
    path: '/trace/public/{code}',
    module: '溯源',
    status: 'PENDING',
    lastCallAt: ''
  },
  {
    code: 'A18',
    name: '检测报告',
    method: 'POST/GET',
    path: '/trace/inspections',
    module: '溯源',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 15:19:26'
  },
  {
    code: 'A19',
    name: '告警列表',
    method: 'GET',
    path: '/alarms',
    module: '告警',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:20:31'
  },
  {
    code: 'A20',
    name: '告警处置',
    method: 'POST',
    path: '/alarms/{id}/handle',
    module: '告警',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:21:14'
  },
  {
    code: 'A21',
    name: 'AI 病虫害诊断',
    method: 'GET/POST',
    path: '/ai/diagnosis',
    module: '分析',
    status: 'JOINING',
    lastCallAt: ''
  },
  {
    code: 'A22',
    name: '统计报表',
    method: 'POST/GET',
    path: '/reports',
    module: '分析',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 14:47:03'
  },
  {
    code: 'A23',
    name: '订单管理',
    method: 'POST/GET',
    path: '/trade/orders',
    module: '产销',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 14:22:49'
  },
  {
    code: 'A24',
    name: '商品与客户',
    method: 'GET/POST',
    path: '/trade/goods、/trade/customers',
    module: '产销',
    status: 'JOINING',
    lastCallAt: ''
  },
  {
    code: 'A25',
    name: '用户与角色',
    method: 'POST/GET',
    path: '/system/users、/system/roles',
    module: '后台',
    status: 'CONNECTED',
    lastCallAt: '2026-11-16 18:25:40'
  },
  {
    code: 'A26',
    name: '开放平台接入',
    method: 'POST',
    path: '/open/apps、/open/token',
    module: '对接',
    status: 'JOINING',
    lastCallAt: ''
  }
]

// 关键接口的请求/响应示例；其余接口按 GET/POST 生成通用示例
const API_SAMPLES = {
  A01: {
    request: { username: 'admin', password: 'admin123' },
    response: {
      code: 0,
      message: 'success',
      data: {
        token: 'mock-token-admin-1',
        user: { id: 1, username: 'admin', name: '系统管理员', roleCode: 'ADMIN' }
      },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A02: {
    request: {},
    response: {
      code: 0,
      message: 'success',
      data: {
        user: { id: 1, username: 'admin', name: '系统管理员', roleCode: 'ADMIN' },
        menus: [{ title: '物联网感知监测', items: [{ path: '/iot/env', title: '环境监测' }] }],
        roles: ['ADMIN'],
        permissions: ['*']
      },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A03: {
    request: { keyword: '温室', page: 1, size: 10 },
    response: {
      code: 0,
      message: 'success',
      data: {
        page: 1,
        size: 10,
        total: 8,
        list: [
          {
            id: 1,
            code: 'DEV-ENV-001',
            name: '1号温室环境采集器',
            plotName: '1号温室',
            status: 'ONLINE'
          }
        ]
      },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A04: {
    request: { deviceCode: 'DEV-CTL-001', action: 'OPEN', duration: 10, reason: '棚内温度偏高' },
    response: {
      code: 0,
      message: 'success',
      data: { requestId: 'CMD-20261116-0001', status: 'SENT' },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A06: {
    request: { plotId: 'PLOT-01' },
    response: {
      code: 0,
      message: 'success',
      data: {
        plotId: 'PLOT-01',
        temperature: 23.6,
        humidity: 68,
        co2: 520,
        light: 18600,
        collectedAt: '2026-11-16 18:29:30'
      },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A18: {
    request: { batchNo: 'BATCH-20261101-01', item: '农残检测' },
    response: {
      code: 0,
      message: 'success',
      data: { id: 12, batchNo: 'BATCH-20261101-01', result: 'PASS', reportNo: 'JC-2026-0012' },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A25: {
    request: { username: 'cdp_user_01', name: '示例用户', phone: '13800000009', roleCode: 'OPS' },
    response: {
      code: 0,
      message: 'success',
      data: { id: 9, username: 'cdp_user_01', roleCode: 'OPS', status: 'ENABLED' },
      timestamp: BUSINESS_NOW_TEXT
    }
  },
  A26: {
    request: { appName: '示例开放平台应用', contact: '张三', purpose: '溯源数据查询' },
    response: {
      code: 0,
      message: 'success',
      data: {
        appId: 'APP-2026-0004',
        appName: '示例开放平台应用',
        appSecret: 'sec_agri_9f2c4e6a8b0d1f3c',
        status: 'ENABLED'
      },
      timestamp: BUSINESS_NOW_TEXT
    }
  }
}

const userStore = useUserStore()

const activeTab = ref('perm')
const menuGroups = ref([])
const permLoading = ref(false)
const permError = ref('')

const permQuery = ref({ keyword: '', type: '' })
const permViewVisible = ref(false)
const permViewRow = ref(null)

const apiQuery = ref({ keyword: '', status: '' })
const apiDrawerVisible = ref(false)
const apiDetail = ref(null)

const apps = ref([])
const openLoading = ref(false)
const openError = ref('')
const openMeta = ref(readJson(OPEN_APP_META_KEY, {}))
const openQuery = ref({ keyword: '', status: '' })

const createVisible = ref(false)
const createSubmitting = ref(false)
const createFormRef = ref(null)
const createForm = ref({ appName: '', contact: '', purpose: '' })
const togglingAppId = ref('')

const createRules = {
  appName: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
  contact: [{ required: true, message: '请输入联系人', trigger: 'blur' }]
}

/** 读取 localStorage 的 JSON 对象，失败时回落到默认值 */
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

/** 写入 localStorage 的 JSON 对象，失败时提示并返回 false */
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    ElMessage.error('本地存储写入失败，本次修改仅在当前页生效')
    return false
  }
}

/** 把 A02 菜单 + 前端按钮常量组装成权限树 */
function buildPermissionTree(groups) {
  return groups.map((group) => {
    const menuNodes = (group.items || []).map((item) => ({
      key: `menu:${item.path}`,
      label: item.title,
      code: MENU_PERMISSION_CODES[item.path] || '',
      type: 'menu',
      module: group.title,
      pageId: item.pageId || ''
    }))
    // 同一权限码在菜单与按钮中重复时只保留菜单节点，避免清单出现重复行
    const usedCodes = new Set(menuNodes.map((node) => node.code).filter(Boolean))
    const buttonNodes = (MODULE_BUTTONS[group.title] || [])
      .filter((button) => !usedCodes.has(button.code))
      .map((button) => ({
        key: `perm:${button.code}`,
        label: button.name,
        code: button.code,
        type: 'button',
        module: group.title
      }))
    return {
      key: `module:${group.title}`,
      label: group.title,
      code: '',
      type: 'module',
      module: group.title,
      children: [...menuNodes, ...buttonNodes]
    }
  })
}

const permissionTree = computed(() => buildPermissionTree(menuGroups.value))

/** 按关键词与类型过滤权限树，保留命中节点的祖先模块 */
const filteredPermissionTree = computed(() => {
  const keyword = String(permQuery.value.keyword || '')
    .trim()
    .toLowerCase()
  const type = permQuery.value.type
  const typeOk = (node) => !type || node.type === type
  const textOk = (node) =>
    !keyword ||
    String(node.label || '')
      .toLowerCase()
      .includes(keyword) ||
    String(node.code || '')
      .toLowerCase()
      .includes(keyword)
  const walk = (nodes) => {
    const result = []
    nodes.forEach((node) => {
      if (node.children && node.children.length) {
        const groupHit = keyword && textOk(node)
        const children = groupHit
          ? node.children.filter((child) => typeOk(child))
          : walk(node.children)
        if (children.length) {
          result.push({ ...node, children })
        }
        return
      }
      if (typeOk(node) && textOk(node)) {
        result.push({ ...node })
      }
    })
    return result
  }
  return walk(permissionTree.value)
})

/** 收集权限树叶子节点（菜单/按钮），用于导出与计数 */
function collectLeaves(nodes, result = []) {
  nodes.forEach((node) => {
    if (node.children && node.children.length) {
      collectLeaves(node.children, result)
    } else if (node.code) {
      result.push(node)
    }
  })
  return result
}

const permLeaves = computed(() => collectLeaves(filteredPermissionTree.value))
// 切换筛选条件后重建表格，让树表重新展开
const permTableKey = computed(() => `${permQuery.value.keyword}|${permQuery.value.type}`)

const permColumns = [
  { prop: 'label', label: '权限名称', minWidth: 240, showOverflowTooltip: true },
  { prop: 'code', label: '权限编码', minWidth: 200, slot: 'code' },
  { prop: 'type', label: '类型', width: 90, slot: 'type' },
  { prop: 'module', label: '所属模块', width: 150 },
  { prop: 'actions', label: '操作', width: 80, slot: 'actions', fixed: 'right' }
]

const permSearchFields = [
  { prop: 'keyword', label: '关键词', type: 'input', placeholder: '权限名称 / 编码' },
  {
    prop: 'type',
    label: '类型',
    type: 'select',
    options: [
      { label: '菜单', value: 'menu' },
      { label: '按钮', value: 'button' }
    ],
    placeholder: '全部类型'
  }
]

const filteredApis = computed(() => {
  const keyword = String(apiQuery.value.keyword || '')
    .trim()
    .toLowerCase()
  const { status } = apiQuery.value
  return API_LIST.filter((api) => {
    if (status && api.status !== status) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [api.code, api.name].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(keyword)
    )
  })
})

const apiStats = computed(() => ({
  total: API_LIST.length,
  connected: API_LIST.filter((api) => api.status === 'CONNECTED').length,
  joining: API_LIST.filter((api) => api.status === 'JOINING').length
}))

const apiCards = computed(() => [
  {
    label: '接口总数',
    value: apiStats.value.total,
    unit: '个',
    icon: 'Connection',
    tone: 'brand'
  },
  {
    label: '已对接',
    value: apiStats.value.connected,
    unit: '个',
    icon: 'CircleCheck',
    tone: 'ok'
  },
  {
    label: '联调中',
    value: apiStats.value.joining,
    unit: '个',
    icon: 'Loading',
    tone: 'warn'
  }
])

// 接口表格列宽合计 1030px，1440 宽视口下不出横向滚动条
const apiColumns = [
  { prop: 'code', label: '编号', width: 80 },
  { prop: 'name', label: '接口名称', width: 160, showOverflowTooltip: true },
  { prop: 'method', label: '方法', width: 70, slot: 'method' },
  { prop: 'path', label: '路径', width: 200, slot: 'path', showOverflowTooltip: true },
  { prop: 'module', label: '所属模块', width: 100 },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'lastCallAt', label: '最近调用', width: 150 },
  { prop: 'actions', label: '操作', width: 180, slot: 'actions', fixed: 'right' }
]

const apiSearchFields = [
  { prop: 'keyword', label: '关键词', type: 'input', placeholder: '接口编号 / 名称' },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: '已对接', value: 'CONNECTED' },
      { label: '联调中', value: 'JOINING' },
      { label: '未对接', value: 'PENDING' }
    ],
    placeholder: '全部状态'
  }
]

const apiSample = computed(() => {
  if (!apiDetail.value) {
    return { request: {}, response: {} }
  }
  const api = apiDetail.value
  const preset = API_SAMPLES[api.code]
  if (preset) {
    return preset
  }
  const isPost = api.method.includes('POST')
  return {
    request: isPost ? { note: '按接口契约传入业务字段' } : { page: 1, size: 10 },
    response: {
      code: 0,
      message: 'success',
      data: isPost ? null : { page: 1, size: 10, total: 0, list: [] },
      timestamp: BUSINESS_NOW_TEXT
    }
  }
})

const requestJson = computed(() => JSON.stringify(apiSample.value.request, null, 2))
const responseJson = computed(() => JSON.stringify(apiSample.value.response, null, 2))

/** 生成 / 派生 AppKey：`app_` + 16 位十六进制 */
function randomHex16() {
  let hex = ''
  while (hex.length < 16) {
    hex += Math.floor(Math.random() * 16).toString(16)
  }
  return hex.slice(0, 16)
}

function makeAppKey() {
  return `app_${randomHex16()}`
}

/** 演示用的稳定 AppKey：种子应用没有 AppKey，按 appId 派生，保证刷新不变 */
function deriveAppKey(seed) {
  const hash = (text) => {
    let value = 0
    for (let index = 0; index < text.length; index += 1) {
      value = (value * 31 + text.charCodeAt(index)) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }
  return `app_${hash(`${seed}-key1`)}${hash(`${seed}-key2`)}`
}

/** AppKey 打码：保留 `app_` 前缀与末 4 位，完整值放在 title 与复制按钮中 */
function maskAppKey(appKey) {
  if (!appKey) {
    return '-'
  }
  return `${appKey.slice(0, 8)}****${appKey.slice(-4)}`
}

const openAppRows = computed(() => {
  const rows = apps.value.map((app) => {
    const meta = openMeta.value[app.appId] || {}
    const appKey = meta.appKey || deriveAppKey(app.appId)
    return {
      ...app,
      appKey,
      appKeyMasked: maskAppKey(appKey),
      status: meta.status || app.status,
      lastAccessAt: meta.lastAccessAt || app.lastAccessAt || '',
      createdAt: app.createdAt || meta.createdAt || '',
      localOnly: false
    }
  })
  // mock 数据库在整页刷新后会回到种子数据，A26 不会再返回本轮新建的应用；
  // 这里把只存在于本地补充记录中的应用重新并入列表，避免刷新即丢失
  const known = new Set(rows.map((row) => row.appId))
  Object.entries(openMeta.value).forEach(([appId, meta]) => {
    if (known.has(appId) || !meta.appName) {
      return
    }
    const appKey = meta.appKey || deriveAppKey(appId)
    rows.push({
      appId,
      appName: meta.appName,
      appKey,
      appKeyMasked: maskAppKey(appKey),
      status: meta.status || 'ENABLED',
      createdAt: meta.createdAt || '',
      lastAccessAt: meta.lastAccessAt || '',
      localOnly: true
    })
  })
  return rows
})

const filteredOpenApps = computed(() => {
  const keyword = String(openQuery.value.keyword || '')
    .trim()
    .toLowerCase()
  const { status } = openQuery.value
  return openAppRows.value.filter((app) => {
    if (status && app.status !== status) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [app.appName, app.appId, app.appKey].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(keyword)
    )
  })
})

// 开放平台表格列宽合计 1050px，1440 宽视口下不出横向滚动条
const openColumns = [
  { prop: 'appName', label: '应用名称', minWidth: 200, slot: 'appName' },
  { prop: 'appKeyMasked', label: 'AppKey', width: 240, slot: 'appKey' },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'createdAt', label: '创建时间', width: 165 },
  { prop: 'lastAccessAt', label: '最近调用', width: 165 },
  { prop: 'actions', label: '操作', width: 190, slot: 'actions', fixed: 'right' }
]

const openSearchFields = [
  { prop: 'keyword', label: '关键词', type: 'input', placeholder: '应用名称 / AppKey' },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' }
    ],
    placeholder: '全部状态'
  }
]

/** 拉取 A02 菜单（权限树的唯一数据来源） */
async function loadMenus() {
  permLoading.value = true
  permError.value = ''
  try {
    await userStore.fetchProfile({ force: true })
    menuGroups.value = Array.isArray(userStore.menus) ? userStore.menus : []
    if (!menuGroups.value.length) {
      permError.value = 'A02 未返回菜单权限数据'
    }
  } catch (error) {
    permError.value = error?.message || '菜单权限加载失败'
  } finally {
    permLoading.value = false
  }
}

/** 拉取 A26 开放平台应用列表 */
async function loadApps() {
  openLoading.value = true
  openError.value = ''
  try {
    const data = await fetchOpenApps({ size: 100 })
    apps.value = Array.isArray(data?.list) ? data.list : []
  } catch (error) {
    openError.value = error?.message || '开放平台应用加载失败'
  } finally {
    openLoading.value = false
  }
}

/** 通用复制：优先 Clipboard API，失败回落到临时 textarea */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Clipboard API 不可用时继续走兜底方案
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-1000px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

async function handleCopyPath(row) {
  const copied = await copyText(row.path)
  if (copied) {
    ElMessage.success(`接口路径已复制：${row.path}`)
  } else {
    ElMessage.error('复制失败，请手动选择路径复制')
  }
}

async function handleCopyAppKey(row) {
  const copied = await copyText(row.appKey)
  if (copied) {
    ElMessage.success(`AppKey 已复制：${row.appKey}`)
  } else {
    ElMessage.error('复制失败，请手动选择 AppKey 复制')
  }
}

function openApiDetail(row) {
  apiDetail.value = row
  apiDrawerVisible.value = true
}

function openPermDetail(row) {
  permViewRow.value = row
  permViewVisible.value = true
}

function permTypeText(type) {
  if (type === 'menu') {
    return '菜单'
  }
  if (type === 'button') {
    return '按钮'
  }
  return '模块'
}

function permTypeTagType(type) {
  if (type === 'menu') {
    return 'primary'
  }
  if (type === 'button') {
    return 'warning'
  }
  return 'info'
}

function methodTagType(method) {
  if (method === 'POST') {
    return 'danger'
  }
  if (method === 'GET') {
    return 'success'
  }
  return 'warning'
}

/** CSV 单元格转义：包裹双引号并转义内部双引号 */
function escapeCsv(cell) {
  const text = String(cell ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

/** 触发浏览器下载（Blob URL 用完即释放） */
function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** 导出当前筛选结果的权限清单 CSV，带 UTF-8 BOM 以兼容 Excel */
function exportPermCsv() {
  const leaves = permLeaves.value
  if (!leaves.length) {
    ElMessage.warning('当前筛选条件下没有可导出的权限')
    return
  }
  const rows = [
    ['权限名称', '权限编码', '类型', '所属模块'],
    ...leaves.map((node) => [node.label, node.code, permTypeText(node.type), node.module])
  ]
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')
  saveBlob(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    `权限清单_${BUSINESS_TODAY}.csv`
  )
  ElMessage.success(`已导出 ${leaves.length} 条权限`)
}

function openCreateApp() {
  createForm.value = { appName: '', contact: '', purpose: '' }
  createVisible.value = true
}

async function submitCreateApp() {
  const form = createFormRef.value
  if (!form) {
    return
  }
  const valid = await form.validate().catch(() => false)
  if (!valid) {
    return
  }
  createSubmitting.value = true
  const appKey = makeAppKey()
  try {
    const created = await createOpenApp({
      appName: String(createForm.value.appName).trim(),
      contact: String(createForm.value.contact).trim(),
      purpose: String(createForm.value.purpose).trim()
    })
    // A26 返回的 appId 不能作为需求要求的 AppKey，本地补充一份并记录创建信息
    const next = {
      ...openMeta.value,
      [created.appId]: {
        appKey,
        appName: created.appName || String(createForm.value.appName).trim(),
        appSecret: created.appSecret || '',
        status: created.status || 'ENABLED',
        createdAt: BUSINESS_NOW_TEXT,
        lastAccessAt: ''
      }
    }
    if (writeJson(OPEN_APP_META_KEY, next)) {
      openMeta.value = next
    }
    createVisible.value = false
    ElMessage.success(`应用已创建，AppKey：${appKey}`)
    await loadApps()
  } catch {
    // 业务错误由 request.js 统一提示，保留弹窗便于修改
  } finally {
    createSubmitting.value = false
  }
}

/** 重置密钥：A26 没有该接口，只改本地补充记录中的 AppSecret */
function resetAppSecret(row) {
  ElMessageBox.confirm(
    `确认重置应用「${row.appName}」的接入密钥？旧密钥将立即失效（本地记录）。`,
    '重置密钥',
    { type: 'warning', confirmButtonText: '确认重置', cancelButtonText: '取消' }
  )
    .then(() => {
      const appSecret = `sec_agri_${randomHex16()}${randomHex16()}`
      const next = {
        ...openMeta.value,
        [row.appId]: { ...(openMeta.value[row.appId] || {}), appSecret }
      }
      if (writeJson(OPEN_APP_META_KEY, next)) {
        openMeta.value = next
        ElMessage.success(`应用「${row.appName}」的接入密钥已重置，新密钥仅本次生成`)
      }
    })
    .catch(() => {
      // 取消重置
    })
}

/** 停用/启用：A26 没有更新接口，只改本地补充记录并提示 */
function toggleAppStatus(row) {
  const nextStatus = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  const actionText = nextStatus === 'ENABLED' ? '启用' : '停用'
  ElMessageBox.confirm(`确认${actionText}应用「${row.appName}」？`, `${actionText}应用`, {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消'
  })
    .then(() => {
      togglingAppId.value = row.appId
      const next = {
        ...openMeta.value,
        [row.appId]: {
          ...(openMeta.value[row.appId] || {}),
          appKey: row.appKey,
          status: nextStatus
        }
      }
      if (writeJson(OPEN_APP_META_KEY, next)) {
        openMeta.value = next
        ElMessage.success(`应用「${row.appName}」已${actionText}（本地记录）`)
      }
    })
    .catch(() => {
      // 取消操作
    })
    .finally(() => {
      togglingAppId.value = ''
    })
}

watch(activeTab, (tab) => {
  if (tab === 'open' && !apps.value.length && !openLoading.value) {
    loadApps()
  }
})

onMounted(() => {
  loadMenus()
  loadApps()
})
</script>

<template>
  <div class="page-container perm-config">
    <AgriPageHeader
      page-id="P030"
      title="权限配置与接口对接"
      description="查看菜单与按钮权限清单、A01–A26 接口对接状态以及开放平台应用接入情况。"
    >
      <template #extra>
        <el-button @click="exportPermCsv">导出权限清单 CSV</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="perm-config__stats">
      <el-col v-for="card in apiCards" :key="card.label" :xs="12" :sm="8" :md="8">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
        />
      </el-col>
    </el-row>
    <p class="perm-config__note text-secondary">
      说明：权限编码与按钮权限为前端常量（A02
      仅返回菜单）；接口对接状态、最近调用时间为示例数据；开放平台的 AppKey 与启停状态因 A26
      缺字段，写浏览器本地补充记录。
    </p>

    <el-tabs v-model="activeTab" class="perm-config__tabs">
      <el-tab-pane label="菜单与按钮权限" name="perm">
        <div class="agri-card perm-config__section">
          <AgriSearchBar v-model="permQuery" :fields="permSearchFields" />

          <div class="perm-config__toolbar">
            <div>
              <h3 class="perm-config__title">权限清单</h3>
              <span class="perm-config__sub text-secondary">
                共 {{ permLeaves.length }} 项权限（菜单 + 按钮），只读展示
              </span>
            </div>
            <el-button :disabled="!permLeaves.length" @click="exportPermCsv">
              导出当前清单
            </el-button>
          </div>

          <div v-if="permError" class="perm-config__error" @click="loadMenus">
            <span class="perm-config__error-icon">!</span>
            <span>{{ permError }}，点击重试</span>
          </div>

          <el-table
            v-else
            :key="permTableKey"
            v-loading="permLoading"
            :data="filteredPermissionTree"
            row-key="key"
            :tree-props="{ children: 'children' }"
            default-expand-all
            empty-text="暂无匹配的权限，请调整关键词或类型"
          >
            <el-table-column
              v-for="column in permColumns"
              :key="column.prop"
              :prop="column.prop"
              :label="column.label"
              :width="column.width"
              :min-width="column.minWidth"
              :show-overflow-tooltip="column.showOverflowTooltip"
            >
              <template v-if="column.slot === 'code'" #default="{ row }">
                <code v-if="row.code" class="perm-config__code">{{ row.code }}</code>
                <span v-else class="text-secondary">-</span>
              </template>
              <template v-else-if="column.slot === 'type'" #default="{ row }">
                <el-tag size="small" :type="permTypeTagType(row.type)" effect="plain">
                  {{ permTypeText(row.type) }}
                </el-tag>
              </template>
              <template v-else-if="column.slot === 'actions'" #default="{ row }">
                <el-button link type="primary" size="small" @click="openPermDetail(row)">
                  查看
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="接口对接" name="api">
        <div class="agri-card perm-config__section">
          <AgriSearchBar v-model="apiQuery" :fields="apiSearchFields" />

          <div class="perm-config__toolbar">
            <div>
              <h3 class="perm-config__title">接口对接清单</h3>
              <span class="perm-config__sub text-secondary">
                共 {{ filteredApis.length }} 个接口，覆盖 A01–A26
              </span>
            </div>
            <span class="perm-config__sub text-secondary">请求/响应为示例数据</span>
          </div>

          <AgriTable
            :columns="apiColumns"
            :data="filteredApis"
            :show-pagination="false"
            row-key="code"
            empty-text="暂无匹配的接口，请调整编号或状态"
          >
            <template #method="{ row }">
              <el-tag size="small" :type="methodTagType(row.method)" effect="plain">
                {{ row.method }}
              </el-tag>
            </template>

            <template #path="{ row }">
              <code class="perm-config__path">{{ row.path }}</code>
            </template>

            <template #status="{ row }">
              <AgriStatusTag :status="row.status" :map="INTERFACE_STATUS_MAP" />
            </template>

            <template #actions="{ row }">
              <div class="perm-config__actions">
                <el-button link type="primary" size="small" @click="handleCopyPath(row)">
                  复制路径
                </el-button>
                <el-button link type="primary" size="small" @click="openApiDetail(row)">
                  查看
                </el-button>
              </div>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>

      <el-tab-pane label="开放平台应用" name="open">
        <div class="agri-card perm-config__section">
          <AgriSearchBar v-model="openQuery" :fields="openSearchFields" />

          <div class="perm-config__toolbar">
            <div>
              <h3 class="perm-config__title">开放平台应用</h3>
              <span class="perm-config__sub text-secondary">
                共 {{ filteredOpenApps.length }} 个应用，AppKey 中间打码展示，可复制完整值
              </span>
            </div>
            <el-button type="primary" @click="openCreateApp">新建应用</el-button>
          </div>

          <div v-if="openError" class="perm-config__error" @click="loadApps">
            <span class="perm-config__error-icon">!</span>
            <span>{{ openError }}，点击重试</span>
          </div>

          <AgriTable
            v-else
            :columns="openColumns"
            :data="filteredOpenApps"
            :loading="openLoading"
            :show-pagination="false"
            row-key="appId"
            empty-text="暂无开放平台应用，点击右上角「新建应用」创建"
          >
            <template #appName="{ row }">
              <div class="perm-config__appname">
                <span class="perm-config__appname-text">{{ row.appName }}</span>
                <el-tag v-if="row.localOnly" type="warning" size="small" effect="plain">
                  本地
                </el-tag>
              </div>
            </template>

            <template #appKey="{ row }">
              <div class="perm-config__appkey">
                <code :title="row.appKey">{{ row.appKeyMasked }}</code>
                <el-button link type="primary" size="small" @click="handleCopyAppKey(row)">
                  复制
                </el-button>
              </div>
            </template>

            <template #status="{ row }">
              <AgriStatusTag :status="row.status" :map="OPEN_APP_STATUS_MAP" />
            </template>

            <template #actions="{ row }">
              <div class="perm-config__actions">
                <el-button link type="primary" size="small" @click="resetAppSecret(row)">
                  重置密钥
                </el-button>
                <el-button
                  link
                  :type="row.status === 'ENABLED' ? 'danger' : 'success'"
                  size="small"
                  :loading="togglingAppId === row.appId"
                  @click="toggleAppStatus(row)"
                >
                  {{ row.status === 'ENABLED' ? '停用' : '启用' }}
                </el-button>
              </div>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 权限详情：只读 -->
    <el-dialog v-model="permViewVisible" title="权限详情" width="520px" append-to-body>
      <el-descriptions v-if="permViewRow" :column="1" border>
        <el-descriptions-item label="权限名称">{{ permViewRow.label }}</el-descriptions-item>
        <el-descriptions-item label="权限编码">
          <code v-if="permViewRow.code">{{ permViewRow.code }}</code>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ permTypeText(permViewRow.type) }}
        </el-descriptions-item>
        <el-descriptions-item label="所属模块">{{ permViewRow.module }}</el-descriptions-item>
        <el-descriptions-item v-if="permViewRow.pageId" label="页面编号">
          {{ permViewRow.pageId }}
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button @click="permViewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 接口详情：请求体 + 响应体示例，用 pre 做代码块高亮样式，不引第三方库 -->
    <el-drawer v-model="apiDrawerVisible" title="接口详情" size="580px">
      <div v-if="apiDetail" class="api-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="接口编号">{{ apiDetail.code }}</el-descriptions-item>
          <el-descriptions-item label="接口名称">{{ apiDetail.name }}</el-descriptions-item>
          <el-descriptions-item label="请求方法">{{ apiDetail.method }}</el-descriptions-item>
          <el-descriptions-item label="所属模块">{{ apiDetail.module }}</el-descriptions-item>
          <el-descriptions-item label="请求路径" :span="2">
            <code>{{ apiDetail.path }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="对接状态" :span="2">
            <AgriStatusTag :status="apiDetail.status" :map="INTERFACE_STATUS_MAP" />
          </el-descriptions-item>
        </el-descriptions>

        <section class="api-detail__block">
          <h4 class="api-detail__title">请求体示例</h4>
          <pre class="api-detail__pre">{{ requestJson }}</pre>
        </section>

        <section class="api-detail__block">
          <h4 class="api-detail__title">响应体示例</h4>
          <pre class="api-detail__pre">{{ responseJson }}</pre>
        </section>
      </div>
    </el-drawer>

    <!-- 新建应用：A26 必填仅应用名称，联系人与用途为前端补充采集 -->
    <el-dialog v-model="createVisible" title="新建开放平台应用" width="560px" append-to-body>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="96px">
        <el-form-item label="应用名称" prop="appName">
          <el-input
            v-model="createForm.appName"
            maxlength="40"
            placeholder="如：第三方溯源查询服务"
          />
        </el-form-item>
        <el-form-item label="联系人" prop="contact">
          <el-input v-model="createForm.contact" maxlength="20" placeholder="请输入联系人姓名" />
        </el-form-item>
        <el-form-item label="用途说明">
          <el-input
            v-model="createForm.purpose"
            type="textarea"
            :rows="3"
            maxlength="100"
            show-word-limit
            placeholder="简要说明接入用途，不超过 100 字"
          />
        </el-form-item>
      </el-form>
      <p class="perm-config__dialog-tip text-secondary">
        保存后由前端生成 AppKey（app_ + 16 位十六进制），A26 返回的 appId 仍作为应用主键。
      </p>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitting" @click="submitCreateApp">
          确定创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.perm-config__stats {
  margin-bottom: $space-sm;
}

.perm-config__note {
  margin: 0 0 $space-md;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.perm-config__section {
  margin-top: 0;
}

.perm-config__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: $space-sm;
  margin: $space-md 0 $space-sm;
}

.perm-config__title {
  margin: 0 0 4px;
  font-size: $font-size-md;
  color: $text-primary;
}

.perm-config__sub {
  font-size: $font-size-xs;
}

.perm-config__code {
  padding: 0 6px;
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-regular;
  background-color: $bg-page;
  border-radius: 3px;
}

.perm-config__path {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-regular;
}

.perm-config__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.perm-config__appname {
  display: flex;
  align-items: center;
  gap: $space-xs;
  min-width: 0;
}

.perm-config__appname-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.perm-config__appkey {
  display: flex;
  gap: 6px;
  align-items: center;
}

.perm-config__appkey code {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-regular;
}

.perm-config__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: $danger-color;
  cursor: pointer;
  border: 1px dashed $border-color;
  border-radius: $radius-md;
}

.perm-config__error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background-color: $danger-color;
  border-radius: 50%;
}

.perm-config__dialog-tip {
  margin: 0;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.api-detail__block {
  margin-top: $space-md;
}

.api-detail__title {
  margin: 0 0 8px;
  font-size: $font-size-sm;
  color: $text-primary;
}

.api-detail__pre {
  max-height: 280px;
  padding: 12px;
  margin: 0;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #e5e7eb;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: #1f2933;
  border-radius: $radius-sm;
}
</style>
