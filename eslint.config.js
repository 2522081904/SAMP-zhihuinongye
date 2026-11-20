/**
 * ESLint 9 Flat Config（扁平配置）
 * 组合：JS 基础规则 + eslint-plugin-vue 官方 flat 预设 + prettier 关停冲突规则。
 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,vue}']
  },
  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/dist/**',
      // 并行子任务的隔离构建产物：dist-t1 … dist-tN、dist-review、dist-final 等
      '**/dist-*/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/_check/**',
      '**/*.min.js'
    ]
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  skipFormatting,
  {
    name: 'app/custom-rules',
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // 浏览器环境
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        // Node 环境（vite.config.js 等构建期配置）
        process: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      // 允许单词组件名（AgriEmpty 等基础组件按项目规范命名）
      'vue/multi-word-component-names': 'off',
      // 骨架阶段允许空函数占位，但禁止未使用的变量遗留
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/require-default-prop': 'off',
      'vue/attribute-hyphenation': ['error', 'always'],
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/html-self-closing': [
        'error',
        { html: { void: 'always', normal: 'always', component: 'always' } }
      ]
    }
  }
]
