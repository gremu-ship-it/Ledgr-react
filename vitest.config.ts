import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'virtual-pwa-register-stub',
      resolveId(id) {
        if (id === 'virtual:pwa-register') return '\0virtual:pwa-register';
        return null;
      },
      load(id) {
        if (id === '\0virtual:pwa-register') {
          return 'export function registerSW() { return async () => {}; }';
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
