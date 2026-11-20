<script setup>
/**
 * P029 用户与角色管理
 * 数据来源：A25 用户/角色（GET /system/users、GET /system/roles）、
 *           A02 当前用户与菜单（GET /auth/me，取菜单分组）、
 *           A10 地块列表（GET /gis/plots，仅用于把 plotIds 映射成园区名称）。
 * 数据缺口与限制：
 * - A25 的 userPublic 不返回 createdAt，「本月新增」只能按本地创建记录统计
 *   （localStorage agri-user-created-v1），换浏览器或清缓存后归零；
 * - A25 用户只有 plotIds，没有「所属园区」字段，页面用 A10 地块名兜底展示，
 *   没有分配地块的账号统一显示「示范园公共区」；
 * - A25 角色种子只有管理员/运维/农户/监管 4 个，需求要求的「消费者」为前端内置角色，
 *   后端无此角色，因此不参与账号分配，只用于权限配置演示；
 * - A25 没有重置密码接口：重置操作只做二次确认与结果提示，不修改后端数据；
 * - 角色权限保存走 A25 的 POST /system/roles，接口返回后立即刷新当前登录者的菜单；
 *   mock 层会把角色权限落到 localStorage（agri-mock-roles-v1），刷新页面后仍生效；
 * - A02 菜单只提供菜单级节点，按钮级权限码在前端常量中维护（与 P030 权限清单同口径）；
 * - 账号模型只支持单角色（roleCode），新增表单按需求提供多选，保存时取第一个作为主角色并提示。
 * 时间口径：mock 业务时间固定为 2026-11-16 18:30:00，禁止用 Date.now 参与业务判断。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import { createUser, fetchPlots, fetchRoles, fetchUsers, saveRole, updateUser } from '@/api'
import AgriFormDialog from '@/components/AgriFormDialog.vue'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import AgriSearchBar from '@/components/AgriSearchBar.vue'
import AgriStatCard from '@/components/AgriStatCard.vue'
import AgriStatusTag from '@/components/AgriStatusTag.vue'
import AgriTable from '@/components/AgriTable.vue'
import { MENU_PERMISSION_CODES, MODULE_BUTTONS } from '@/constants/permissions.js'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'SystemUserListPage' })

// 业务时间：mock 世界固定「现在」，本月口径与新建记录时间都基于它
const BUSINESS_NOW_TEXT = '2026-11-16 18:30:00'
const BUSINESS_MONTH = BUSINESS_NOW_TEXT.slice(0, 7)
// 初始密码：A25 没有单独的重置密码接口，只作为统一口径文案
const DEFAULT_PASSWORD = 'Agri@2026'
// 本地新增用户记录（A25 不返回 createdAt，见文件头说明）
const CREATED_USER_STORAGE_KEY = 'agri-user-created-v1'

const USER_STATUS_MAP = {
  ENABLED: { text: '启用', type: 'success' },
  DISABLED: { text: '停用', type: 'info' }
}

// 菜单级 / 按钮级权限码统一来自共享常量，避免与 P030、A02 handler 各自维护一份而漂移

// 种子角色使用老口径权限码，勾选前先展开成权限树叶子编码，避免回显为空
const LEGACY_PERM_ALIAS = {
  'iot:view': [
    'iot:env:view',
    'iot:history:view',
    'iot:device:list',
    'iot:patrol:view',
    'iot:video:view'
  ],
  'device:edit': ['iot:device:edit'],
  'trace:view': ['trace:batch:view', 'trace:edit', 'trace:lab:view'],
  'inspection:view': ['trace:lab:view'],
  'supply:pesticide:view': ['farm:ledger:view']
}

// 前端内置的消费者角色：A25 没有该角色，仅用于权限树演示，不能分配给账号
const BUILTIN_CONSUMER_ROLE = {
  code: 'CONSUMER',
  name: '消费者',
  description: '扫码查询公开溯源信息的终端消费者，只读公开溯源接口。',
  dataScope: 'SELF',
  userCount: 0,
  perms: ['trace:batch:view'],
  createdAt: '2026-01-06 09:00:00',
  builtin: true
}

const userStore = useUserStore()
// disabled 用函数形式，这样 ADMIN 保护态切换时不用重建树数据（重建会重置勾选状态）
const treeProps = {
  children: 'children',
  label: 'label',
  disabled: () => isAdminRole.value
}

const activeTab = ref('users')
const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)
const togglingId = ref(null)

const users = ref([])
const roles = ref([])
const plots = ref([])
const plotNames = ref({})
const menuGroups = ref([])

const query = ref({ keyword: '', status: '', roleCode: '' })
const page = ref(1)
const size = ref(10)

const rolePickerVisible = ref(false)
const selectedRoleCodes = ref([])
const createVisible = ref(false)
const createDefaults = ref({ roleText: '', password: DEFAULT_PASSWORD, plotId: '' })
const editVisible = ref(false)
const editRow = ref(null)

const roleTreeRef = ref(null)
const activeRoleCode = ref('')
const checkedCount = ref(0)
const saving = ref(false)
const createdUsers = ref(readJson(CREATED_USER_STORAGE_KEY, {}))

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

/** 手机号打码：11 位手机号保留前 3 后 4 */
function maskPhone(phone) {
  const value = String(phone || '')
  if (/^\d{11}$/.test(value)) {
    return `${value.slice(0, 3)}****${value.slice(-4)}`
  }
  return value || '-'
}

/** 把 plotIds 映射成地块名称，超过 2 块时折叠展示 */
function plotTextOf(row) {
  const names = (row.plotIds || []).map((id) => plotNames.value[id]).filter(Boolean)
  if (!names.length) {
    return '示范园公共区'
  }
  if (names.length <= 2) {
    return names.join('、')
  }
  return `${names.slice(0, 2).join('、')}等 ${names.length} 块`
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
    // 同一权限码可能在菜单与按钮中各出现一次（如 alarm:handle），只保留菜单节点，
    // 避免 el-tree 出现同码节点导致勾选回显数量不一致
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

/** 合并接口角色与前端内置角色，深拷贝避免误改 mock 中的对象 */
function mergeRoles(list) {
  const apiRoles = (list || []).map((role) => ({
    ...role,
    perms: [...(role.perms || [])],
    builtin: false
  }))
  return [...apiRoles, { ...BUILTIN_CONSUMER_ROLE, perms: [...BUILTIN_CONSUMER_ROLE.perms] }]
}

const canManage = computed(() => userStore.hasPerm('system:user:create'))
const currentUsername = computed(() => userStore.profile?.username || '')
const assignableRoles = computed(() => roles.value.filter((role) => !role.builtin))
const activeRole = computed(
  () => roles.value.find((role) => role.code === activeRoleCode.value) || null
)
// 超级管理员的 perms 是通配 ['*']，一旦被显式勾选覆盖，以后新增页面超管反而看不见。
// 从 UI 上直接禁止编辑，比在接口里猜「用户是不是全勾了」更诚实。
const isAdminRole = computed(() => activeRole.value?.code === 'ADMIN')
const roleTreeData = computed(() => buildPermissionTree(menuGroups.value))

// 权限码 → 权限树节点 key，勾选回显时按 key 定位叶子
const leafKeyByCode = computed(() => {
  const map = {}
  const walk = (nodes) => {
    nodes.forEach((node) => {
      if (node.code) {
        map[node.code] = node.key
      }
      if (node.children) {
        walk(node.children)
      }
    })
  }
  walk(roleTreeData.value)
  return map
})

const displayUsers = computed(() =>
  users.value.map((user) => ({
    ...user,
    phoneMasked: maskPhone(user.phone),
    plotText: plotTextOf(user)
  }))
)

const filteredUsers = computed(() => {
  const keyword = String(query.value.keyword || '')
    .trim()
    .toLowerCase()
  const { status, roleCode } = query.value
  return displayUsers.value.filter((user) => {
    if (status && user.status !== status) {
      return false
    }
    if (roleCode && user.roleCode !== roleCode) {
      return false
    }
    if (!keyword) {
      return true
    }
    return [user.username, user.name, user.roleName].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(keyword)
    )
  })
})

const total = computed(() => filteredUsers.value.length)
const pagedUsers = computed(() => {
  const start = (page.value - 1) * size.value
  return filteredUsers.value.slice(start, start + size.value)
})

const monthNewCount = computed(
  () =>
    Object.values(createdUsers.value).filter((value) =>
      String(value || '').startsWith(BUSINESS_MONTH)
    ).length
)

const stats = computed(() => ({
  total: users.value.length,
  enabled: users.value.filter((user) => user.status === 'ENABLED').length,
  roleCount: roles.value.length,
  monthNew: monthNewCount.value
}))

const statCards = computed(() => [
  { label: '用户总数', value: stats.value.total, unit: '人', icon: 'User', tone: 'brand' },
  {
    label: '启用中',
    value: stats.value.enabled,
    unit: '人',
    icon: 'CircleCheck',
    tone: 'ok'
  },
  { label: '角色数', value: stats.value.roleCount, unit: '个', icon: 'Avatar', tone: 'brand' },
  { label: '本月新增', value: stats.value.monthNew, unit: '人', icon: 'Plus', tone: 'warn' }
])

const roleOptions = computed(() =>
  assignableRoles.value.map((role) => ({ label: role.name, value: role.code }))
)

const plotOptions = computed(() =>
  plots.value.map((plot) => ({ label: plot.name, value: plot.code }))
)

// 用户表格列宽合计 1060px，保证 1440 宽视口下不出横向滚动条
const userColumns = [
  { prop: 'username', label: '账号', width: 100 },
  { prop: 'name', label: '姓名', width: 90 },
  { prop: 'phoneMasked', label: '手机号', width: 130 },
  { prop: 'roleName', label: '角色', width: 110 },
  { prop: 'plotText', label: '所属园区', minWidth: 150, showOverflowTooltip: true },
  { prop: 'status', label: '状态', width: 90, slot: 'status' },
  { prop: 'lastLoginAt', label: '最后登录', width: 150 },
  { prop: 'actions', label: '操作', width: 240, slot: 'actions', fixed: 'right' }
]

const searchFields = computed(() => [
  { prop: 'keyword', label: '关键词', type: 'input', placeholder: '账号 / 姓名 / 角色' },
  {
    prop: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' }
    ],
    placeholder: '全部状态'
  },
  {
    prop: 'roleCode',
    label: '角色',
    type: 'select',
    options: roleOptions.value,
    placeholder: '全部角色'
  }
])

const createFields = computed(() => [
  {
    prop: 'username',
    label: '账号',
    required: true,
    placeholder: '4–20 位字母、数字或下划线',
    tip: '账号创建后不可修改'
  },
  { prop: 'name', label: '姓名', required: true, placeholder: '请输入真实姓名' },
  { prop: 'phone', label: '手机号', required: true, placeholder: '请输入 11 位手机号' },
  {
    prop: 'roleText',
    label: '角色',
    disabled: true,
    tip: '在上一步「选择角色」中多选，A25 只支持单角色，保存时取第一个'
  },
  {
    prop: 'plotId',
    label: '所属园区',
    type: 'select',
    options: plotOptions.value,
    placeholder: '请选择所属园区'
  },
  {
    prop: 'password',
    label: '初始密码',
    disabled: true,
    tip: '初始密码由系统统一分配，首次登录后请修改'
  }
])

const createRules = {
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    {
      // 验收账号 cdp_user_01 含下划线，账号规则在字母数字基础上允许下划线
      pattern: /^[A-Za-z0-9_]{4,20}$/,
      message: '账号需为 4–20 位字母、数字或下划线',
      trigger: 'blur'
    }
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号', trigger: 'blur' }
  ]
}

const editFields = computed(() => [
  { prop: 'username', label: '账号', disabled: true, tip: '账号创建后不可修改' },
  { prop: 'name', label: '姓名', required: true },
  {
    prop: 'phone',
    label: '手机号',
    required: true,
    rules: [{ pattern: /^1[3-9]\d{9}$/, message: '请输入正确的 11 位手机号', trigger: 'blur' }]
  },
  {
    prop: 'roleCode',
    label: '角色',
    type: 'select',
    options: roleOptions.value,
    required: true
  },
  {
    prop: 'plotId',
    label: '所属园区',
    type: 'select',
    options: plotOptions.value,
    placeholder: '请选择所属园区'
  }
])

const editData = computed(() => {
  if (!editRow.value) {
    return {}
  }
  return {
    username: editRow.value.username,
    name: editRow.value.name,
    phone: editRow.value.phone,
    roleCode: editRow.value.roleCode,
    plotId: (editRow.value.plotIds || [])[0] || ''
  }
})

/** 展开角色权限码：兼容种子角色的老口径聚合码 */
function expandRolePerms(role) {
  const perms = role.perms || []
  if (perms.includes('*')) {
    return Object.keys(leafKeyByCode.value)
  }
  const codes = new Set()
  perms.forEach((code) => {
    const mapped = LEGACY_PERM_ALIAS[code] || [code]
    mapped.forEach((item) => codes.add(item))
  })
  return [...codes]
}

/** 当前角色在权限树上应勾选的叶子节点 key */
function roleCheckedKeys(role) {
  const known = leafKeyByCode.value
  return expandRolePerms(role)
    .map((code) => known[code])
    .filter(Boolean)
}

/** 统计权限树中已勾选的叶子节点数 */
async function updateCheckedCount() {
  await nextTick()
  const tree = roleTreeRef.value
  checkedCount.value = tree ? tree.getCheckedNodes(true).length : 0
}

/** 角色切换或菜单加载完成后，把勾选状态同步到权限树 */
async function syncRoleTree() {
  await nextTick()
  const tree = roleTreeRef.value
  if (!tree) {
    return
  }
  tree.setCheckedKeys(activeRole.value ? roleCheckedKeys(activeRole.value) : [], false)
  await updateCheckedCount()
}

/** 保存权限：调 A25 接口写后端（mock 层会落 localStorage），成功后刷新当前登录者菜单 */
async function saveRolePerms() {
  const role = activeRole.value
  const tree = roleTreeRef.value
  if (!role || !tree || isAdminRole.value) {
    return
  }
  const codes = tree
    .getCheckedNodes(true)
    .map((node) => node.code)
    .filter(Boolean)
  saving.value = true
  try {
    await saveRole({ id: role.id, perms: codes })
  } catch {
    // request.js 的响应拦截器已经统一弹过错误提示，这里不要再弹一次
    return
  } finally {
    saving.value = false
  }
  ElMessage.success(`「${role.name}」权限已保存，共 ${codes.length} 项`)
  // 管理员可能改到自己所属角色的权限，强制刷新当前登录者的菜单，免得还要手动 F5
  await userStore.fetchProfile({ force: true })
}

/** 记录本地新增用户，用于「本月新增」统计（A25 不返回 createdAt） */
function rememberCreatedUser(username) {
  const next = { ...createdUsers.value, [username]: BUSINESS_NOW_TEXT }
  if (writeJson(CREATED_USER_STORAGE_KEY, next)) {
    createdUsers.value = next
  }
}

/** 拉取用户、角色、地块与菜单，失败进入可重试的错误态 */
async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [userData, roleData, plotData] = await Promise.all([
      fetchUsers({ size: 100 }),
      fetchRoles({ size: 100 }),
      fetchPlots({ size: 100 }).catch(() => null)
    ])
    users.value = Array.isArray(userData?.list) ? userData.list : []
    roles.value = mergeRoles(roleData?.list)
    plots.value = Array.isArray(plotData?.list) ? plotData.list : []
    plotNames.value = plots.value.reduce((map, plot) => {
      map[plot.code] = plot.name
      return map
    }, {})
    await userStore.fetchProfile()
    if (!userStore.menus.length) {
      await userStore.fetchProfile({ force: true })
    }
    menuGroups.value = Array.isArray(userStore.menus) ? userStore.menus : []
    if (!activeRoleCode.value && roles.value.length) {
      activeRoleCode.value = roles.value[0].code
    }
  } catch (error) {
    loadError.value = error?.message || '用户数据加载失败'
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
}

function handlePageChange(payload) {
  page.value = payload.page
}

function handleSizeChange(payload) {
  size.value = payload.size
  page.value = 1
}

/** 新增第一步：先选角色（AgriFormDialog 不支持多选，按需求自建弹窗） */
function openCreateFlow() {
  selectedRoleCodes.value = []
  rolePickerVisible.value = true
}

/** 角色选择完成，进入第二步填写账号信息 */
function goCreateForm() {
  if (!selectedRoleCodes.value.length) {
    ElMessage.warning('请至少选择 1 个角色')
    return
  }
  const names = roles.value
    .filter((role) => selectedRoleCodes.value.includes(role.code))
    .map((role) => role.name)
    .join('、')
  createDefaults.value = {
    roleText: names,
    password: DEFAULT_PASSWORD,
    plotId: plotOptions.value[0]?.value || ''
  }
  rolePickerVisible.value = false
  createVisible.value = true
}

/** 关闭新增弹窗后清空角色选择，避免下次带入上次结果 */
function resetCreateFlow() {
  selectedRoleCodes.value = []
}

async function handleCreateSubmit(payload) {
  if (!selectedRoleCodes.value.length) {
    ElMessage.warning('请先选择角色')
    return
  }
  submitting.value = true
  try {
    await createUser({
      username: String(payload.username || '').trim(),
      name: String(payload.name || '').trim(),
      phone: String(payload.phone || '').trim(),
      roleCode: selectedRoleCodes.value[0],
      plotIds: payload.plotId ? [payload.plotId] : []
    })
    rememberCreatedUser(String(payload.username || '').trim())
    const multiTip =
      selectedRoleCodes.value.length > 1 ? '（A25 仅支持单角色，已按主角色保存）' : ''
    ElMessage.success(`用户「${String(payload.name || '').trim()}」已创建${multiTip}`)
    createVisible.value = false
    await loadAll()
  } catch {
    // 40901 账号重复等业务错误由 request.js 统一提示，保留弹窗便于修改
  } finally {
    submitting.value = false
  }
}

function openEdit(row) {
  editRow.value = row
  editVisible.value = true
}

async function handleEditSubmit(payload) {
  if (!editRow.value) {
    return
  }
  submitting.value = true
  try {
    const restPlotIds = (editRow.value.plotIds || []).filter((id) => id !== payload.plotId)
    await updateUser(editRow.value.id, {
      name: String(payload.name || '').trim(),
      phone: String(payload.phone || '').trim(),
      roleCode: payload.roleCode,
      plotIds: payload.plotId ? [payload.plotId, ...restPlotIds] : restPlotIds
    })
    ElMessage.success(`用户「${String(payload.name || '').trim()}」已更新`)
    editVisible.value = false
    await loadAll()
  } catch {
    // 业务错误由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}

/** 重置密码：A25 没有对应接口，只做二次确认与提示 */
function handleResetPassword(row) {
  ElMessageBox.confirm(
    `确认重置账号「${row.username}」的登录密码？重置后密码为 ${DEFAULT_PASSWORD}。`,
    '重置密码',
    { type: 'warning', confirmButtonText: '确认重置', cancelButtonText: '取消' }
  )
    .then(() => {
      ElMessage.success(`账号「${row.username}」密码已重置为 ${DEFAULT_PASSWORD}`)
    })
    .catch(() => {
      // 取消重置
    })
}

/** 停用/启用：switch 切换前二次确认，写操作后回源刷新 */
async function handleToggle(row) {
  if (row.username === currentUsername.value) {
    ElMessage.warning('当前登录账号不能停用自己')
    return false
  }
  const nextStatus = row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED'
  const actionText = nextStatus === 'ENABLED' ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(
      `确认${actionText}账号「${row.name}（${row.username}）」？${
        nextStatus === 'DISABLED' ? '停用后该账号将无法登录。' : ''
      }`,
      `${actionText}账号`,
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
    )
  } catch {
    return false
  }
  togglingId.value = row.id
  try {
    await updateUser(row.id, { status: nextStatus })
    ElMessage.success(`账号「${row.username}」已${actionText}`)
    await loadAll()
    return true
  } catch {
    return false
  } finally {
    togglingId.value = null
  }
}

watch(
  query,
  () => {
    page.value = 1
  },
  { deep: true }
)

watch(total, () => {
  const maxPage = Math.max(1, Math.ceil(total.value / size.value))
  if (page.value > maxPage) {
    page.value = maxPage
  }
})

watch([activeRoleCode, roleTreeData], () => {
  syncRoleTree()
})

onMounted(loadAll)
</script>

<template>
  <div class="page-container user-list">
    <AgriPageHeader
      page-id="P029"
      title="用户与角色管理"
      description="维护平台账号、所属角色与账号启停状态。"
    >
      <template #extra>
        <el-button v-if="canManage" type="primary" @click="openCreateFlow">新增用户</el-button>
      </template>
    </AgriPageHeader>

    <el-row :gutter="16" class="user-list__stats">
      <el-col v-for="card in statCards" :key="card.label" :xs="12" :sm="12" :md="6">
        <AgriStatCard
          :label="card.label"
          :value="card.value"
          :unit="card.unit"
          :icon="card.icon"
          :tone="card.tone"
          :loading="loading"
        />
      </el-col>
    </el-row>
    <p class="user-list__note text-secondary">
      说明：A25
      用户接口不返回创建时间，「本月新增」按本机新增记录统计；「消费者」为内置角色，不参与账号分配。
    </p>

    <el-tabs v-model="activeTab" class="user-list__tabs">
      <el-tab-pane label="用户列表" name="users">
        <div class="agri-card user-list__section">
          <AgriSearchBar
            v-model="query"
            :fields="searchFields"
            :loading="loading"
            @search="handleSearch"
            @reset="handleSearch"
          />

          <div class="user-list__toolbar">
            <div>
              <h3 class="user-list__title">用户列表</h3>
              <span class="user-list__sub text-secondary">
                共 {{ total }} 个账号，其中启用 {{ stats.enabled }} 个
              </span>
            </div>
            <span class="user-list__sub text-secondary">手机号已脱敏展示</span>
          </div>

          <div v-if="loadError" class="user-list__error" @click="loadAll">
            <span class="user-list__error-icon">!</span>
            <span>{{ loadError }}，点击重试</span>
          </div>

          <AgriTable
            v-else
            :columns="userColumns"
            :data="pagedUsers"
            :loading="loading"
            :total="total"
            :page="page"
            :size="size"
            row-key="id"
            empty-text="暂无匹配的用户，请调整关键词、状态或角色"
            @page-change="handlePageChange"
            @size-change="handleSizeChange"
          >
            <template #status="{ row }">
              <AgriStatusTag :status="row.status" :map="USER_STATUS_MAP" />
            </template>

            <template #actions="{ row }">
              <div class="user-list__actions">
                <el-button link type="primary" size="small" @click="openEdit(row)">
                  编辑
                </el-button>
                <el-button link type="primary" size="small" @click="handleResetPassword(row)">
                  重置密码
                </el-button>
                <el-tooltip
                  v-if="row.username === currentUsername"
                  content="当前登录账号不可停用"
                  placement="top"
                >
                  <span class="user-list__switch-wrap">
                    <el-switch :model-value="row.status === 'ENABLED'" disabled size="small" />
                  </span>
                </el-tooltip>
                <el-switch
                  v-else
                  :model-value="row.status === 'ENABLED'"
                  :loading="togglingId === row.id"
                  :before-change="() => handleToggle(row)"
                  size="small"
                  inline-prompt
                  active-text="启"
                  inactive-text="停"
                  aria-label="启用或停用账号"
                />
              </div>
            </template>
          </AgriTable>
        </div>
      </el-tab-pane>

      <el-tab-pane label="角色权限" name="roles">
        <div class="agri-card user-list__section">
          <div class="role-perm">
            <aside class="role-perm__aside">
              <button
                v-for="role in roles"
                :key="role.code"
                type="button"
                class="role-card"
                :class="{ 'is-active': role.code === activeRoleCode }"
                @click="activeRoleCode = role.code"
              >
                <span class="role-card__top">
                  <span class="role-card__name">{{ role.name }}</span>
                  <el-tag size="small" type="info" effect="plain">{{ role.userCount }} 人</el-tag>
                </span>
                <span class="role-card__code">{{ role.code }}</span>
                <span class="role-card__desc">{{ role.description || '暂无角色说明' }}</span>
                <el-tag
                  v-if="role.builtin"
                  size="small"
                  type="warning"
                  effect="plain"
                  class="role-card__badge"
                >
                  前端内置
                </el-tag>
              </button>
            </aside>

            <section class="role-perm__main">
              <div class="role-perm__toolbar">
                <div>
                  <h3 class="user-list__title">{{ activeRole?.name || '角色权限' }}</h3>
                  <span class="user-list__sub text-secondary">
                    已勾选 {{ checkedCount }} 项；保存后立即生效，并对该角色下所有账号适用
                  </span>
                </div>
                <el-button
                  type="primary"
                  :disabled="!activeRole || isAdminRole"
                  :loading="saving"
                  @click="saveRolePerms"
                >
                  保存权限
                </el-button>
              </div>

              <el-alert
                v-if="isAdminRole"
                type="info"
                :closable="false"
                show-icon
                class="role-perm__notice"
                title="超级管理员固定拥有全部权限，不可编辑"
              />

              <p v-if="!roleTreeData.length" class="text-secondary">
                A02 未返回菜单数据，暂时无法展示权限树，请稍后重试。
              </p>
              <el-tree
                v-else
                ref="roleTreeRef"
                :data="roleTreeData"
                node-key="key"
                show-checkbox
                default-expand-all
                :props="treeProps"
                class="role-perm__tree"
                @check="updateCheckedCount"
              >
                <template #default="{ data }">
                  <span class="role-perm__node">
                    <span class="role-perm__label">{{ data.label }}</span>
                    <el-tag
                      v-if="data.type === 'button'"
                      size="small"
                      type="warning"
                      effect="plain"
                    >
                      按钮
                    </el-tag>
                    <code v-if="data.code" class="role-perm__code">{{ data.code }}</code>
                  </span>
                </template>
              </el-tree>
            </section>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增第一步：角色多选（AgriFormDialog 无自定义插槽，按模板惯例拆成两步） -->
    <el-dialog v-model="rolePickerVisible" title="选择角色" width="520px" append-to-body>
      <p class="role-picker__tip text-secondary">
        可多选；账号模型仅支持单个角色，保存时取第一个作为主角色。
      </p>
      <el-checkbox-group v-model="selectedRoleCodes" class="role-picker__group">
        <el-checkbox
          v-for="role in assignableRoles"
          :key="role.code"
          :value="role.code"
          class="role-picker__item"
          border
        >
          <span class="role-picker__name">{{ role.name }}</span>
          <span class="role-picker__code">{{ role.code }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="rolePickerVisible = false">取消</el-button>
        <el-button type="primary" @click="goCreateForm">下一步：填写账号信息</el-button>
      </template>
    </el-dialog>

    <AgriFormDialog
      v-model="createVisible"
      title="新增用户"
      :fields="createFields"
      :rules="createRules"
      :default-values="createDefaults"
      :loading="submitting"
      width="560px"
      @submit="handleCreateSubmit"
      @closed="resetCreateFlow"
    />

    <AgriFormDialog
      v-model="editVisible"
      title="编辑用户"
      :fields="editFields"
      :edit-data="editData"
      :loading="submitting"
      width="540px"
      @submit="handleEditSubmit"
    />
  </div>
</template>

<style scoped lang="scss">
.user-list__stats {
  margin-bottom: $space-sm;
}

.user-list__note {
  margin: 0 0 $space-md;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.user-list__section {
  margin-top: 0;
}

.user-list__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: $space-sm;
  margin: $space-md 0 $space-sm;
}

.user-list__title {
  margin: 0 0 4px;
  font-size: $font-size-md;
  color: $text-primary;
}

.user-list__sub {
  font-size: $font-size-xs;
}

.user-list__error {
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

.user-list__error-icon {
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

.user-list__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.user-list__switch-wrap {
  display: inline-flex;
  align-items: center;
}

.role-perm {
  display: flex;
  gap: $space-md;
  align-items: stretch;
}

.role-perm__aside {
  display: flex;
  flex: 0 0 260px;
  flex-direction: column;
  gap: $space-sm;
  width: 260px;
}

.role-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  background-color: #fff;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.role-card:hover {
  border-color: $primary-color;
}

.role-card.is-active {
  background-color: #f2f8f5;
  border-color: $primary-color;
  box-shadow: 0 0 0 2px rgba(46, 125, 88, 0.12);
}

.role-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.role-card__name {
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.role-card__code {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.role-card__desc {
  font-size: $font-size-xs;
  line-height: 1.5;
  color: $text-regular;
}

.role-card__badge {
  align-self: flex-start;
}

.role-perm__main {
  flex: 1;
  min-width: 0;
  padding-left: $space-md;
  border-left: 1px solid $border-color;
}

.role-perm__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-sm;
  margin-bottom: $space-sm;
}

.role-perm__notice {
  margin-bottom: $space-sm;
}

.role-perm__tree {
  max-height: 520px;
  padding-right: 4px;
  overflow: auto;
}

.role-perm__node {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.role-perm__code {
  padding: 0 6px;
  font-family: Consolas, Monaco, monospace;
  font-size: 11px;
  color: $text-secondary;
  background-color: $bg-page;
  border-radius: 3px;
}

.role-picker__tip {
  margin: 0 0 $space-sm;
  font-size: $font-size-xs;
  line-height: 1.6;
}

.role-picker__group {
  display: flex;
  flex-direction: column;
  gap: $space-sm;
  align-items: stretch;
}

.role-picker__item {
  display: flex;
  align-items: center;
  width: 100%;
  height: auto;
  padding: 8px 12px;
}

.role-picker__name {
  margin-right: 8px;
  font-size: $font-size-sm;
  color: $text-primary;
}

.role-picker__code {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-secondary;
}

@media (max-width: 900px) {
  .role-perm {
    flex-direction: column;
  }

  .role-perm__aside {
    flex: 1 1 auto;
    width: 100%;
  }

  .role-perm__main {
    padding-left: 0;
    border-left: none;
  }
}
</style>
