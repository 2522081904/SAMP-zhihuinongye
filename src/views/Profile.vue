<script setup>
/**
 * 个人信息（自助页，不属于原 33 个业务页面，pageId 留空）
 *
 * 职责：让每个登录角色都能查看自己的账号资料，并自助修改登录密码。
 * 历史上的「个人信息」下拉项直接跳 /system/users，而该页 meta.perm 为
 * system:user:view（只有 ADMIN 拥有），其余角色一点就撞 /403，因此本页不设 meta.perm。
 *
 * 数据来源：
 * - 账号资料：A02 GET /auth/me（经 store 的 normalizeProfile 归一化，见 fetchProfile）
 * - 修改密码：A27 PUT /auth/password（后端 handler 由 TASK-1 提供）
 *
 * 地块名：A02 只返回 plotIds（如 ['PLOT-01']），地块名从本仓库 mock 种子数据映射，
 * 复用登录页 import '@/mock/db.js' 的既有先例；找不到时原样展示 id，不隐藏信息。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { changePassword } from '@/api'
import AgriPageHeader from '@/components/AgriPageHeader.vue'
import { plots } from '@/mock/db.js'
import { useUserStore } from '@/store/modules/user'

defineOptions({ name: 'UserProfilePage' })

const userStore = useUserStore()

// 整页加载遮罩：首次进入（或 F5 后 store 只有 token）时先等 A02 回来，避免闪一屏空值
const pageLoading = ref(false)
// 顶部「刷新资料」按钮的独立 loading，不与整页遮罩互相影响
const refreshing = ref(false)

const profile = computed(() => userStore.userInfo)

/** 头像文字：取姓名的第一个字（Array.from 防止拆开代理对） */
const avatarText = computed(() => {
  const name = profile.value?.name || profile.value?.username || ''
  return Array.from(name)[0] || '农'
})

const isDisabled = computed(() => profile.value?.status === 'DISABLED')
// statusName 由 store 的 normalizeProfile 统一给出（DISABLED → 已停用，其余 → 正常）
const statusText = computed(
  () => profile.value?.statusName || (isDisabled.value ? '已停用' : '正常')
)

/** 负责地块：plotIds → 地块名，映射不到时保留原始 id；多块用空格分隔 */
const plotText = computed(() => {
  const ids = Array.isArray(profile.value?.plotIds) ? profile.value.plotIds : []
  if (ids.length === 0) {
    return '不限定地块'
  }
  return ids
    .map((id) => {
      const matched = plots.find((item) => item.id === id)
      return matched?.name || id
    })
    .join(' ')
})

const lastLoginText = computed(() => profile.value?.lastLoginAt || '—')
const createdAtText = computed(() => profile.value?.createdAt || '—')

/** 载入资料：store 里已有档案就直接用，否则补拉一次 A02（内部有并发合流） */
async function loadProfile() {
  if (userStore.userInfo) {
    return
  }
  pageLoading.value = true
  try {
    await userStore.fetchProfile()
  } finally {
    pageLoading.value = false
  }
}

/** 手动刷新：强制重拉一次档案（refreshProfile = fetchProfile({ force: true })） */
async function handleRefresh() {
  refreshing.value = true
  try {
    await userStore.refreshProfile()
  } finally {
    refreshing.value = false
  }
}

// ---------------------------- 修改密码 ----------------------------

const passwordFormRef = ref(null)
const submitting = ref(false)

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

/**
 * 新密码校验（与后端口径保持一致）：8–32 位，且必须同时含字母和数字。
 * 新密码一变，已填好的确认密码要重新判定是否仍一致。
 * @param {Object} _rule el-form 规则对象（未使用）
 * @param {string} value 输入值
 * @param {(error?: Error) => void} callback 校验回调
 */
function validateNewPassword(_rule, value, callback) {
  if (!value) {
    callback(new Error('请输入新密码'))
    return
  }
  if (value.length < 8 || value.length > 32) {
    callback(new Error('新密码长度需为 8–32 位'))
    return
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    callback(new Error('新密码需同时包含字母和数字'))
    return
  }
  if (value === passwordForm.oldPassword) {
    callback(new Error('新密码不能与原密码相同'))
    return
  }
  // 传了 callback 时 validateField 不会抛 Promise，避免未捕获的 rejection 打到控制台
  if (passwordForm.confirmPassword) {
    passwordFormRef.value?.validateField('confirmPassword', () => {})
  }
  callback()
}

/**
 * 确认新密码校验：必填且必须与新密码一致。
 * @param {Object} _rule el-form 规则对象（未使用）
 * @param {string} value 输入值
 * @param {(error?: Error) => void} callback 校验回调
 */
function validateConfirmPassword(_rule, value, callback) {
  if (!value) {
    callback(new Error('请再次输入新密码'))
    return
  }
  if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入的新密码不一致'))
    return
  }
  callback()
}

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [{ validator: validateNewPassword, trigger: 'blur' }],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: 'blur' }]
}

/**
 * 提交改密：前端校验全部通过才发请求。
 * 失败提示由 request.js 统一弹出，这里刻意不再弹一次，避免出现两条相同错误。
 */
async function submitPassword() {
  if (!passwordFormRef.value) {
    return
  }
  try {
    await passwordFormRef.value.validate()
  } catch {
    // 校验未通过：表单项下方已有错误文案
    return
  }
  submitting.value = true
  try {
    await changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword
    })
    ElMessage.success('密码已修改')
    passwordFormRef.value.resetFields()
  } catch {
    // 错误已由 request.js 统一提示（40102 原密码不正确等），此处保持静默
  } finally {
    submitting.value = false
  }
}

onMounted(loadProfile)
</script>

<template>
  <div class="page-container profile-page">
    <AgriPageHeader page-id="" title="个人信息" description="查看本人账号资料并修改登录密码。">
      <template #extra>
        <el-button :loading="refreshing" @click="handleRefresh">刷新资料</el-button>
      </template>
    </AgriPageHeader>

    <div v-loading="pageLoading" class="profile-page__body">
      <!-- 账号资料 -->
      <div class="agri-card profile-page__card">
        <h3 class="profile-page__card-title">账号资料</h3>
        <div class="profile-info">
          <div class="profile-info__avatar">{{ avatarText }}</div>
          <el-descriptions class="profile-info__desc" :column="2" border>
            <el-descriptions-item label="姓名">
              {{ profile?.name || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="登录账号">
              {{ profile?.username || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="角色">
              {{ profile?.roleName || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="账号状态">
              <el-tag :type="isDisabled ? 'info' : 'success'" size="small" effect="plain">
                {{ statusText }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="手机号">
              {{ profile?.phone || '未填写' }}
            </el-descriptions-item>
            <el-descriptions-item label="邮箱">
              {{ profile?.email || '未填写' }}
            </el-descriptions-item>
            <el-descriptions-item label="负责地块">
              {{ plotText }}
            </el-descriptions-item>
            <el-descriptions-item label="最近登录">
              {{ lastLoginText }}
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">
              {{ createdAtText }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>

      <!-- 修改密码：所有角色都能改自己的密码 -->
      <div class="agri-card profile-page__card">
        <h3 class="profile-page__card-title">修改密码</h3>
        <p class="profile-page__hint">
          新密码需 8–32 位且同时包含字母和数字；修改成功后本次登录状态保持不变。
        </p>
        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-width="96px"
          class="profile-page__form"
          @submit.prevent
        >
          <el-form-item label="原密码" prop="oldPassword">
            <el-input
              v-model="passwordForm.oldPassword"
              type="password"
              show-password
              placeholder="请输入当前登录密码"
              autocomplete="current-password"
            />
          </el-form-item>
          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              placeholder="8–32 位，含字母和数字"
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              show-password
              placeholder="请再次输入新密码"
              autocomplete="new-password"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submitPassword">
              确认修改
            </el-button>
            <el-button :disabled="submitting" @click="passwordFormRef?.resetFields()">
              重置
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.profile-page__body {
  display: flex;
  flex-direction: column;
  gap: $space-md;
}

.profile-page__card-title {
  margin-bottom: $space-md;
  font-size: $font-size-md;
  font-weight: 600;
  color: $text-primary;
}

.profile-info {
  display: flex;
  align-items: flex-start;
  gap: $space-lg;
}

.profile-info__avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  font-size: $font-size-xl;
  font-weight: 600;
  color: #fff;
  background-color: $primary-color;
  border-radius: 50%;
}

.profile-info__desc {
  flex: 1;
  min-width: 0;
}

.profile-page__hint {
  margin-bottom: $space-md;
  font-size: $font-size-sm;
  color: $text-secondary;
  line-height: 1.6;
}

.profile-page__form {
  max-width: 520px;
}

@media (max-width: 768px) {
  .profile-info {
    flex-direction: column;
    align-items: center;
  }

  .profile-info__desc {
    width: 100%;
  }

  .profile-page__form {
    max-width: none;
  }
}
</style>
