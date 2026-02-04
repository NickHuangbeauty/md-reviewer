import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 重要：設置 base 為您的 GitHub 倉庫名稱
  // 例如：如果您的倉庫是 https://github.com/username/md-reviewer
  // 則設置為 '/md-reviewer/'
  base: '/md-reviewer/',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
