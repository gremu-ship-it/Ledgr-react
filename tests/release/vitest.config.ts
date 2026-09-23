import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    include: ['tests/release/*.test.ts'], environment: 'node',
    setupFiles: ['tests/release/setup.ts'], fileParallelism: false,
    testTimeout: 30000, hookTimeout: 420000, // R09.4 beforeAll builds the PWA + harness pages
    onConsoleLog() { return false; },
  },
});
