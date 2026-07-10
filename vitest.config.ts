import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Emulator tests need a Java runtime + firebase emulator; they run via `npm run test:emulator`
    // (their own vitest.emulator.config.ts), kept out of the fast, Java-free default suite.
    exclude: ['tests/e2e/**/*', 'tests/emulator/**/*'],
    setupFiles: ['./tests/setup.ts']
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})