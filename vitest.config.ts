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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    // src/lib/supabase.ts throws at import time when these are absent, and it
    // is reachable from most modules via lib/repositories.ts. Without them any
    // test that imports a service — even to exercise a pure function that never
    // touches the network — fails on module load rather than on an assertion.
    // These are the same non-secret placeholders CI passes to the build.
    env: {
      VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
  },
});
