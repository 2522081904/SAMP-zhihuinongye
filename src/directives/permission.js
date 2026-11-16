/**
 * v-perm 按钮级权限指令（占位实现）
 * 用法：<el-button v-perm="'iot:control'">下发指令</el-button>
 * 当前校验 userStore.permissions；后端接入后改为比对接口返回的权限码集合。
 */
import { useUserStore } from '@/store/modules/user'

function checkPermission(el, binding) {
  const required = binding.value
  if (!required) {
    return
  }
  const userStore = useUserStore()
  const codes = userStore.permissions || []
  const requiredList = Array.isArray(required) ? required : [required]
  const passed = requiredList.some((code) => codes.includes(code))
  if (!passed) {
    el.parentNode?.removeChild(el)
  }
}

export default {
  mounted(el, binding) {
    checkPermission(el, binding)
  }
}
