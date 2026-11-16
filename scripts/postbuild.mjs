/**
 * 构建后处理脚本（npm run build 的最后一步）
 * 作用：让 dist/ 能直接放到 GitHub Pages 这类纯静态托管上跑 SPA。
 *   1. 复制 dist/index.html 为 dist/404.html —— Pages 对不存在的路径返回 404.html，
 *      该文件就是应用入口，路由在客户端接管后即可还原 /iot/env 这类深链接；
 *   2. 写出 dist/.nojekyll —— 关闭 Pages 上的 Jekyll 处理，
 *      避免下划线开头的资源目录（Vite 产物里可能出现的 _xxx）被 Jekyll 忽略。
 * 该脚本可重复执行，覆盖旧产物即可。
 */
import { access, copyFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/ 在工程根下，dist/ 与之同级
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(projectRoot, 'dist')
const indexFile = resolve(distDir, 'index.html')
const fallbackFile = resolve(distDir, '404.html')
const nojekyllFile = resolve(distDir, '.nojekyll')

// 构建产物缺失时直接失败，避免推上去一个空站
try {
  await access(indexFile)
} catch {
  console.error(`[postbuild] 未找到 ${indexFile}，请先执行 vite build`)
  process.exit(1)
}

// 1) SPA 深链接回退：404.html 与 index.html 内容一致
await copyFile(indexFile, fallbackFile)

// 2) 关闭 Jekyll：空文件即可表达该语义
await writeFile(nojekyllFile, '', 'utf8')

console.log('[postbuild] 已生成 dist/404.html 与 dist/.nojekyll')
