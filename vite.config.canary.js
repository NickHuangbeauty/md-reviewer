import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Canary build configuration
// Deploys to /md-reviewer/canary/ subdirectory
export default defineConfig({
  plugins: [react()],
  base: '/md-reviewer/canary/',
  build: {
    outDir: 'dist/canary',
    sourcemap: true,
  },
  define: {
    'import.meta.env.VITE_CANARY': JSON.stringify(true),
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(process.env.GITHUB_SHA || 'local'),
  }
})
