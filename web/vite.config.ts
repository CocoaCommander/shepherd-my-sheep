import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, mode }) => {
  // Only the dev server proxies to the API, so only it needs API_PORT; tests and
  // builds run without a .env. Read from the repo-root .env (as the Makefile
  // does), with the shell environment taking precedence. No fallback port.
  const devServer = command === 'serve' && mode !== 'test'
  const apiPort = loadEnv(mode, path.resolve(__dirname, '..'), '').API_PORT
  if (devServer && !apiPort) {
    throw new Error('API_PORT is not set; add it to .env at the repo root')
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Process CSS Modules so `styles.x` in tests holds the real class name (otherwise it's `{}`).
      css: { include: [/\.module\.css$/], modules: { classNameStrategy: 'non-scoped' } },
    },
    server: {
      port: 3000,
      proxy: devServer
        ? {
            '/graphql': {
              target: `http://localhost:${apiPort}`,
              changeOrigin: true,
            },
          }
        : undefined,
    },
  }
})
