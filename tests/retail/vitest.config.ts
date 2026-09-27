import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Retail customer workflow simulation — standalone (NOT part of the release
 * gate). Boots the same disposable embedded PostgreSQL 17 fixture as the
 * release harness (full migration replay, production-shaped uuid columns via
 * LEDGR_R13_LIVE_UUID_SHAPE=1) and drives the 12-scenario retail journey with
 * the REAL client payload builders from src/services/posService.ts and
 * src/services/posSaleRpc.ts.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '../../src') },
  },
  test: {
    environment: 'node',
    include: ['tests/retail/*.test.ts'],
    globals: false,
    testTimeout: 300000,
    hookTimeout: 600000,
  },
});
