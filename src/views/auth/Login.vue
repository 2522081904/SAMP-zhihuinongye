<script setup>
/**
 * P001 登录页
 * 职责：账号密码登录入口，登录成功后写入 token 并跳转工作台。
 * 验证码由前端生成并在提交前校验：4 位字母数字、排除易混淆字符，
 * 校验不通过就不发起登录请求；开发构建下把当前验证码挂到 window.__agriCaptcha，
 * 供自动化测试读取（生产构建该分支会被 tree-shake 掉，不残留任何旁路）。
 * 表单下方提供演示账号面板，账号 / 角色直接来自 mock 种子，避免手抄常量造成数据不一致。
 * 若由路由守卫拦下来（?redirect=/iot/env），登录成功后跳回原地址。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import { roles, users } from '@/mock/db.js'
import { firstAllowedPath } from '@/router'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'LoginPage' })

// 验证码字符集：去掉 0/O/1/I/l 等易混淆字符，降低人工辨认出错率
const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CAPTCHA_LENGTH = 4
// canvas 逻辑尺寸（CSS 像素）：高度贴合表单行高，宽度保证卡片内一行放得下
const CAPTCHA_WIDTH = 100
const CAPTCHA_HEIGHT = 38
// 演示账号统一密码：mock 登录只要求非空，固定成 admin123 便于一键填入
const DEMO_PASSWORD = 'admin123'
// 字符与干扰线共用的深色系调色板：与农业绿主色协调，且在浅色底上足够清晰
const CAPTCHA_COLORS = ['#2f6b3a', '#1f5f8b', '#8a4b12', '#6b3fa0', '#0f6b5c', '#7a2f2f']

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)
// 当前验证码文本，只存在于组件内存里，不写 DOM 属性也不写 aria-label
const captchaText = ref('')
const captchaCanvas = ref(null)

const form = reactive({
  username: 'admin',
  password: 'admin123',
  captcha: ''
})

/**
 * 解析登录后要跳回的目标地址。
 * 只接受站内路径（以单个 / 开头），避免 redirect 参数被用来跳到外部站点。
 * 没有来路（直接打开登录页）时落到当前角色第一个有权访问的页面，
 * 不能写死 /iot/env —— 该页并非所有角色都有权限，写死会让部分账号一登录就撞 403。
 * @returns {string} 站内路径
 */
function resolveRedirect() {
  const redirect = route.query.redirect
  const target = typeof redirect === 'string' ? redirect : ''
  if (target.startsWith('/') && !target.startsWith('//')) {
    return target
  }
  return firstAllowedPath(userStore.hasPerm)
}

/**
 * 生成 [min, max] 区间内的随机整数（含两端）。
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number} 随机整数
 */
function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * 随机生成 4 位验证码文本。
 * @returns {string} 验证码文本
 */
function createCaptchaText() {
  let text = ''
  for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
    text += CAPTCHA_CHARS.charAt(randomInt(0, CAPTCHA_CHARS.length - 1))
  }
  return text
}

/**
 * 用 canvas 绘制当前验证码：字符随机旋转 / 错位 + 干扰线与噪点。
 * 按 devicePixelRatio 放大画布再用 CSS 尺寸缩回，避免高分屏下字迹发虚。
 */
function drawCaptcha() {
  const canvas = captchaCanvas.value
  if (!canvas) {
    return
  }
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(CAPTCHA_WIDTH * ratio)
  canvas.height = Math.round(CAPTCHA_HEIGHT * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  // 以 CSS 像素为坐标系绘制，缩放交给 setTransform
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, CAPTCHA_WIDTH, CAPTCHA_HEIGHT)
  ctx.fillStyle = '#f5f8f4'
  ctx.fillRect(0, 0, CAPTCHA_WIDTH, CAPTCHA_HEIGHT)

  // 噪点：浅色小方点只做视觉干扰，不遮挡字符主体
  for (let index = 0; index < 36; index += 1) {
    ctx.fillStyle = `rgba(${randomInt(90, 180)}, ${randomInt(110, 190)}, ${randomInt(90, 170)}, 0.45)`
    ctx.fillRect(randomInt(0, CAPTCHA_WIDTH - 1), randomInt(0, CAPTCHA_HEIGHT - 1), 1.5, 1.5)
  }

  // 干扰线：3 条低透明度曲线，压在字符下层
  for (let index = 0; index < 3; index += 1) {
    ctx.strokeStyle = CAPTCHA_COLORS[randomInt(0, CAPTCHA_COLORS.length - 1)]
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(randomInt(0, 10), randomInt(4, CAPTCHA_HEIGHT - 4))
    ctx.quadraticCurveTo(
      CAPTCHA_WIDTH / 2 + randomInt(-12, 12),
      randomInt(0, CAPTCHA_HEIGHT),
      CAPTCHA_WIDTH - randomInt(0, 10),
      randomInt(4, CAPTCHA_HEIGHT - 4)
    )
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // 字符：每个字符独立旋转 / 上下错位，颜色从深色系里取
  const slotWidth = CAPTCHA_WIDTH / CAPTCHA_LENGTH
  captchaText.value.split('').forEach((char, index) => {
    ctx.save()
    ctx.translate(
      slotWidth * (index + 0.5) + randomInt(-2, 2),
      CAPTCHA_HEIGHT / 2 + randomInt(-3, 3)
    )
    ctx.rotate((randomInt(-22, 22) * Math.PI) / 180)
    ctx.font = `bold ${randomInt(20, 26)}px "Trebuchet MS", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = CAPTCHA_COLORS[randomInt(0, CAPTCHA_COLORS.length - 1)]
    ctx.fillText(char, 0, 0)
    ctx.restore()
  })
}

/**
 * 换一张验证码：重新生成文本、重绘画布，并清空已输入的验证码。
 * @param {boolean} [clearInput=true] 是否清空输入框（首次渲染传 false）
 */
function refreshCaptcha(clearInput = true) {
  captchaText.value = createCaptchaText()
  if (clearInput) {
    form.captcha = ''
  }
  drawCaptcha()
  // 仅开发构建暴露当前验证码给自动化测试；生产构建中 import.meta.env.DEV 为常量 false，
  // 整个分支会被 Rollup / esbuild 的 tree-shaking 移除，不会残留读取旁路
  if (import.meta.env.DEV) {
    window.__agriCaptcha = captchaText.value
  }
}

/** 点击 canvas / 「换一张」：换一张并清空输入 */
function handleRefreshCaptcha() {
  refreshCaptcha()
}

/**
 * 校验验证码：为空提示、错误则自动换一张；比较时忽略首尾空格与大小写。
 * @returns {boolean} 是否通过校验
 */
function checkCaptcha() {
  const input = String(form.captcha || '')
    .trim()
    .toUpperCase()
  if (!input) {
    ElMessage.warning('请输入验证码')
    return false
  }
  if (input !== captchaText.value) {
    ElMessage.error('验证码不正确')
    refreshCaptcha()
    return false
  }
  return true
}

async function handleLogin() {
  if (loading.value) {
    return
  }
  // 验证码不通过时直接返回，不发起登录请求
  if (!checkCaptcha()) {
    return
  }
  loading.value = true
  try {
    await userStore.login({ username: form.username, password: form.password })
    // 登录成功后立刻补拉 A02 档案（姓名 / 角色 / 权限码），
    // 否则顶栏只能显示兜底文案，按钮级权限也拿不到真实权限集合
    await userStore.fetchProfile({ force: true })
    ElMessage.success('登录成功')
    // 换掉已用的验证码，避免同一张被重复提交
    refreshCaptcha()
    // router 的编程式跳转会自动带上部署基路径（GitHub Pages 子路径场景）
    router.replace(resolveRedirect())
  } catch {
    // 失败提示由 request.js 拦截器统一弹出（如 40102 账号或密码错误），这里不重复提示
  } finally {
    loading.value = false
  }
}

// 演示账号按角色分组：人数由种子数组长度推导，不写死 2/2/3/2
const demoGroups = computed(() =>
  roles
    .map((role) => ({
      code: role.code,
      name: role.name,
      members: users.filter((item) => item.roleCode === role.code)
    }))
    .filter((group) => group.members.length > 0)
)
const demoUserCount = computed(() => users.length)

/**
 * 点击演示账号行：一键填入账号与统一密码，验证码仍需按图输入。
 * @param {Object} member mock 种子用户
 */
function fillDemoAccount(member) {
  form.username = member.username
  form.password = DEMO_PASSWORD
  form.captcha = ''
  ElMessage.success(`已填入 ${member.name} 的账号`)
}

onMounted(() => {
  refreshCaptcha(false)
})

onBeforeUnmount(() => {
  // 离开页面时清掉开发钩子，避免在 window 上残留验证码
  if (import.meta.env.DEV) {
    delete window.__agriCaptcha
  }
})
</script>

<template>
  <div class="login-page">
    <div class="login-page__panel">
      <AgriPageHeader
        page-id="P001"
        title="登录页"
        description="账号密码登录入口，登录成功后写入 token 并跳转工作台。"
      />
      <el-form class="login-page__form" :model="form" label-width="72px" @submit.prevent>
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="请输入账号" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item label="验证码">
          <div class="login-page__captcha">
            <el-input
              v-model="form.captcha"
              class="login-page__captcha-input"
              maxlength="4"
              placeholder="请输入验证码"
              autocomplete="off"
              @keyup.enter="handleLogin"
            />
            <canvas
              ref="captchaCanvas"
              class="login-page__captcha-canvas"
              width="200"
              height="76"
              role="img"
              aria-label="图形验证码，点击可换一张"
              title="点击换一张"
              @click="handleRefreshCaptcha"
            />
            <el-button link type="primary" @click="handleRefreshCaptcha">换一张</el-button>
          </div>
        </el-form-item>
        <el-button
          type="primary"
          class="login-page__submit"
          :loading="loading"
          @click="handleLogin"
        >
          登录
        </el-button>
        <p class="login-page__tip">
          验证码不区分大小写，点击图片或「换一张」可刷新；演示账号见下方，点击可一键填入。
        </p>
      </el-form>

      <el-collapse class="login-page__demo">
        <el-collapse-item name="demo">
          <template #title>
            <span class="login-page__demo-title">
              演示账号（{{ demoUserCount }} 个，点击可一键填入）
            </span>
          </template>
          <div v-for="group in demoGroups" :key="group.code" class="login-page__demo-group">
            <p class="login-page__demo-group-name">
              {{ group.name }}（{{ group.members.length }}）
            </p>
            <button
              v-for="member in group.members"
              :key="member.username"
              type="button"
              class="login-page__demo-user"
              @click="fillDemoAccount(member)"
            >
              <span class="login-page__demo-account">{{ member.username }}</span>
              <span class="login-page__demo-name">{{ member.name }}</span>
              <span class="login-page__demo-role">
                {{ member.roleName }}
                <span v-if="member.status === 'DISABLED'" class="login-page__demo-disabled">
                  已停用
                </span>
              </span>
            </button>
          </div>
          <p class="login-page__demo-note">
            密码统一为 admin123；任意非空密码均可登录，密码填 wrong
            可演示登录失败；标记「已停用」的账号登录会提示账号锁定。
          </p>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  // 面板展开后可能高于视口，留出上下内边距并允许页面滚动
  padding: $space-lg 0;
  background-color: $bg-page;
}

.login-page__panel {
  width: 420px;
  padding: $space-lg;
  background-color: #fff;
  border-radius: $radius-md;
  box-shadow: $shadow-md;
}

.login-page__form {
  margin-top: $space-lg;
}

// 验证码行：输入框自适应剩余宽度，canvas 与「换一张」固定不换行
.login-page__captcha {
  display: flex;
  align-items: center;
  gap: $space-sm;
  width: 100%;
}

.login-page__captcha-input {
  flex: 1;
  min-width: 0;
}

.login-page__captcha-canvas {
  flex: none;
  width: 100px;
  height: 38px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  cursor: pointer;
}

.login-page__submit {
  width: 100%;
}

// 演示环境说明：明确这里是本地 mock 登录，不是真实服务端认证
.login-page__tip {
  margin-top: $space-md;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
  text-align: center;
}

// 演示账号面板：与登录卡片同色系，默认收起
.login-page__demo {
  margin-top: $space-md;
  border-top: 1px solid $border-color;
  border-bottom: 0;

  :deep(.el-collapse-item__header) {
    height: auto;
    padding: $space-sm 0;
    font-size: $font-size-sm;
    color: $text-regular;
    border-bottom: 0;
  }

  :deep(.el-collapse-item__wrap) {
    border-bottom: 0;
  }

  :deep(.el-collapse-item__content) {
    padding-bottom: $space-sm;
  }
}

.login-page__demo-title {
  font-size: $font-size-sm;
  color: $text-regular;
}

.login-page__demo-group {
  margin-bottom: $space-sm;
}

.login-page__demo-group-name {
  margin: 0 0 $space-xs;
  font-size: $font-size-xs;
  font-weight: 600;
  color: $text-secondary;
}

// 一行一个账号：账号 / 姓名 / 角色三列对齐，整行可点击
.login-page__demo-user {
  display: grid;
  grid-template-columns: 86px 1fr auto;
  align-items: center;
  gap: $space-sm;
  width: 100%;
  padding: $space-xs $space-sm;
  font-family: inherit;
  font-size: $font-size-xs;
  color: $text-regular;
  text-align: left;
  background: none;
  border: 0;
  border-radius: $radius-sm;
  cursor: pointer;

  &:hover {
    background-color: $primary-lighter;
  }
}

.login-page__demo-account {
  font-family: Consolas, 'Courier New', monospace;
  color: $primary-color;
}

.login-page__demo-name {
  color: $text-primary;
}

.login-page__demo-role {
  color: $text-secondary;
  text-align: right;
}

.login-page__demo-disabled {
  margin-left: $space-xs;
  color: $danger-color;
}

.login-page__demo-note {
  margin: $space-sm 0 0;
  font-size: $font-size-xs;
  line-height: 1.6;
  color: $text-secondary;
}
</style>
