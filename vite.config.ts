import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from 'vite-plugin-singlefile'
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  // inspectAttr 仅开发环境启用：它会把源码文件名和行号注入产物，生产构建必须排除。
  // 生产构建使用 viteSinglefile 将 JS/CSS 全部内联进 index.html ——
  // Electron 以 file:// 加载页面时 origin 为 null，外链 module script 会被 CORS 拦截导致黑屏。
  plugins: [...(mode === 'development' ? [inspectAttr()] : [viteSingleFile()]), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
