import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // Edge-Function shared modules (_shared/*) deliberately use only
      // Web-standard APIs so their security helpers (HMAC, SSRF guard,
      // HTML sanitiser) are unit-testable under Node.
      'supabase/functions/**/*.test.ts',
    ],
    globals: false,
  },
});
