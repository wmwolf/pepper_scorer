import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**/*'],
    setupFiles: ['./tests/setup.ts']
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})