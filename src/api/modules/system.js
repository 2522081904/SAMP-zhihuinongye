/**
 * 系统管理接口封装（A25）
 * 用户与角色维护仅限管理员；角色支持带 id 的保存（新增/修改统一入口）。
 */
import request from '../request.js'
import { writeConfig } from '../request-id.js'

/** A25 用户列表 · P029/P030 */
export const fetchUsers = (params) => request.get('/system/users', { params })

/** A25 新增用户（账号重复返回 40901） · P029 */
export const createUser = (payload) => request.post('/system/users', payload, writeConfig())

/** 扩展 修改用户（改角色/停用账号） · P029 */
export const updateUser = (id, payload) =>
  request.put(`/system/users/${id}`, payload, writeConfig())

/** A25 角色列表 · P029/P030 */
export const fetchRoles = (params) => request.get('/system/roles', { params })

/** A25 保存角色（body 带 id 为修改，返回更新后的角色对象） · P029/P030 */
export const saveRole = (payload) => request.post('/system/roles', payload, writeConfig())
