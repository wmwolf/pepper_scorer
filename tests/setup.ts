import { vi } from 'vitest'

// Mock window object for tests
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      href: 'http://localhost:3000'
    }
  },
  writable: true
})

// Mock getPath function used in gameState.ts
vi.mock('../src/lib/path-utils', () => ({
  getPath: vi.fn((path: string) => path)
}))