<script setup>
/**
 * 移动端入口弹窗
 * - 顶栏「移动端」按钮点开：移动端工作台二维码 + 当前链接复制 + 三个移动端页面入口
 * - 二维码用 canvas 逐模块绘制（qrcode-generator 只给矩阵不给位图），留 4 格静区并铺白底
 * - 模块边长取整数 CSS 像素，canvas 位图再按 DPR 放大，
 *   这样浏览器无需缩放位图，模块边缘不会因重采样而宽窄不均（抖动的模块会降低扫码成功率）
 * - 二维码只在弹窗打开后生成，关闭态不占 CPU 也不碰尚未挂载的 canvas
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import qrcode from 'qrcode-generator'

defineOptions({ name: 'AgriMobileEntry' })

const props = defineProps({
  // 弹窗显隐，配合 v-model 使用
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

const router = useRouter()

// 窄屏断点：与 AgriFormDialog 保持一致，640px 以下弹窗改撑满视口
const NARROW_QUERY = '(max-width: 640px)'
// 二维码静区宽度（模块数）：规范要求 4 格，去掉会明显降低识别率
const QR_QUIET_ZONE = 4
// 二维码最大显示边长（CSS 像素）：实际值取「不超过此值的整数模块边长 × 模块数」
const QR_MAX_SIZE = 222

const isNarrow = ref(false)
const canvasRef = ref(null)
let mediaQuery = null

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 窄屏下 520px 定宽会横向溢出，改成「视口宽 - 32px」，与 AgriFormDialog 的做法一致
const dialogWidth = computed(() => (isNarrow.value ? 'calc(100vw - 32px)' : '520px'))

/**
 * 移动端工作台的绝对地址。
 * 用 new URL 相对 origin + BASE_URL 解析：既带得上部署子路径，
 * 也不会像朴素的 replace(/\/{2,}/g, '/') 那样把 https:// 的协议双斜杠一并吃掉。
 */
const mobileUrl = computed(() => {
  const base = import.meta.env.BASE_URL || '/'
  const origin = window.location.origin
  return new URL('m/home', `${origin}${base}`).href
})

// 三个移动端入口：needLogin 只用于文案提示，真正的拦截由路由守卫负责
const entries = [
  { path: '/m/home', label: '移动端工作台', desc: '环境与农事总览', needLogin: true },
  { path: '/m/checkin', label: '农事打卡上传', desc: '拍照上报农事记录', needLogin: true },
  { path: '/trace/scan', label: '扫码溯源查询', desc: '消费者免登录查批次', needLogin: false }
]

/**
 * 在 canvas 上绘制二维码。
 * 位图尺寸 = CSS 尺寸 × DPR，模块边长取整数，保证设备像素与模块一一对齐。
 */
function drawQr() {
  const canvas = canvasRef.value
  if (!canvas) {
    return
  }

  // 参数顺序是 (typeNumber, errorCorrectionLevel)，typeNumber 0 = 自动选版本。
  // 写成 qrcode('M','L') 会让 make() 抛 Invalid array length。
  const qr = qrcode(0, 'M')
  qr.addData(mobileUrl.value)
  qr.make()

  const moduleCount = qr.getModuleCount()
  const totalModules = moduleCount + QR_QUIET_ZONE * 2
  // 每个模块的 CSS 边长取整数，二维码总宽随模块数浮动（约 200～222px）
  const moduleSize = Math.max(2, Math.floor(QR_MAX_SIZE / totalModules))
  const displaySize = moduleSize * totalModules
  // 位图按 DPR 放大，CSS 尺寸固定为 displaySize，二者整数倍关系下不会产生重采样
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
  const bitmapSize = displaySize * dpr

  canvas.width = bitmapSize
  canvas.height = bitmapSize
  canvas.style.width = `${displaySize}px`
  canvas.style.height = `${displaySize}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  // 白底必须铺满：透明背景在深色主题下会被当成黑色模块，直接扫不出来
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, bitmapSize, bitmapSize)

  ctx.fillStyle = '#000000'
  const cell = moduleSize * dpr
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) {
        continue
      }
      ctx.fillRect((col + QR_QUIET_ZONE) * cell, (row + QR_QUIET_ZONE) * cell, cell, cell)
    }
  }
}

/**
 * 复制文本：优先 Clipboard API，非安全上下文（http 且非 localhost）回落到 execCommand。
 * @param {string} text 待复制内容
 */
async function copyText(text) {
  if (!text) {
    return
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

/**
 * 跳转到移动端页面：先关弹窗，再推路由，避免弹窗盖在新页面上。
 * @param {string} path 目标站内路径
 */
function openEntry(path) {
  dialogVisible.value = false
  router.push(path)
}

// 弹窗打开后要等 el-dialog 的内容渲染完（默认懒渲染，首次打开时 canvas 还不存在）；
// @opened 在过渡动画结束时再兜一次，两次绘制都是幂等的。
watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) {
      return
    }
    await nextTick()
    drawQr()
  }
)

function handleMediaChange(event) {
  isNarrow.value = event.matches
  // 断点跨越后弹窗宽度变了，二维码本身尺寸不变，无需重绘
}

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia(NARROW_QUERY)
    isNarrow.value = mediaQuery.matches
    mediaQuery.addEventListener('change', handleMediaChange)
  }
})

onBeforeUnmount(() => {
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', handleMediaChange)
  }
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="移动端入口"
    :width="dialogWidth"
    append-to-body
    class="agri-mobile-entry"
    @opened="drawQr"
  >
    <p class="agri-mobile-entry__tip">
      用手机扫描下方二维码打开移动端。工作台与农事打卡需要登录，扫码溯源查询无需登录。
    </p>

    <div class="agri-mobile-entry__qr">
      <canvas ref="canvasRef" class="agri-mobile-entry__canvas" />
    </div>

    <div class="agri-mobile-entry__link">
      <span class="agri-mobile-entry__url">{{ mobileUrl }}</span>
      <el-button link type="primary" @click="copyText(mobileUrl)">复制</el-button>
    </div>

    <ul class="agri-mobile-entry__list">
      <li v-for="entry in entries" :key="entry.path" class="agri-mobile-entry__item">
        <el-button
          link
          type="primary"
          class="agri-mobile-entry__jump"
          @click="openEntry(entry.path)"
        >
          {{ entry.label }}
        </el-button>
        <span class="agri-mobile-entry__path">{{ entry.path }}</span>
        <span class="agri-mobile-entry__desc">
          {{ entry.desc }}
          <span v-if="!entry.needLogin" class="agri-mobile-entry__badge">免登录</span>
        </span>
      </li>
    </ul>
  </el-dialog>
</template>

<style scoped lang="scss">
.agri-mobile-entry__tip {
  margin: 0 0 $space-md;
  font-size: $font-size-sm;
  line-height: 1.6;
  color: $text-regular;
}

.agri-mobile-entry__qr {
  display: flex;
  justify-content: center;
  padding: $space-sm 0 $space-md;
}

.agri-mobile-entry__canvas {
  // 二维码必须有白底：canvas 在深色背景下不能靠透明背景
  background-color: #fff;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
}

.agri-mobile-entry__link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $space-sm;
  padding-bottom: $space-md;
  border-bottom: 1px solid $border-color;
}

.agri-mobile-entry__url {
  max-width: 100%;
  overflow: hidden;
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agri-mobile-entry__list {
  margin: 0;
  padding: $space-md 0 0;
  list-style: none;
}

.agri-mobile-entry__item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: $space-sm;
  padding: $space-xs 0;
}

.agri-mobile-entry__jump {
  font-size: $font-size-base;
}

.agri-mobile-entry__path {
  font-family: Consolas, Monaco, monospace;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.agri-mobile-entry__desc {
  margin-left: auto;
  font-size: $font-size-xs;
  color: $text-secondary;
}

.agri-mobile-entry__badge {
  padding: 0 $space-xs;
  margin-left: $space-xs;
  color: $primary-color;
  background-color: $primary-lighter;
  border-radius: $radius-sm;
}
</style>
