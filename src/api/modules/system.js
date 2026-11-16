/**
 * 系统管理接口（模块：系统设置）
 */
import request from '@/api/request'

/** 用户分页列表 */
export function getUserPage(params) {
  return request.get('/system/users', { params })
}

/** 角色列表 */
export function getRoleList() {
  return request.get('/system/roles')
}

/** 权限树 */
export function getPermissionTree() {
  return request.get('/system/permissions')
}

/** 保存角色权限配置 */
export function saveRolePermission(roleId, data) {
  return request.put(`/system/roles/${roleId}/permissions`, data)
}
