/**
 * R09.4 — bundle the browser harness pages with esbuild.
 * Real production modules are bundled verbatim; only the designated seams
 * are redirected to tests/browser mocks (see mock-*.ts docblocks).
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = process.env.R094_PAGES_OUT ?? join(root, '.cache', 'r094', 'pages');

const MOCK_MAP = {
  '@/lib/supabase': join(here, 'mock-supabase.ts'),
  '@/store/useAppStore': join(here, 'mock-appstore.ts'),
  '@/hooks/usePermissions': join(here, 'mock-drawer-deps.ts'),
  '@/hooks/useOnlineStatus': join(here, 'mock-drawer-deps.ts'),
  '@/offline/offlineSyncContext': join(here, 'mock-drawer-deps.ts'),
  '@tests/mock-appstore': join(here, 'mock-appstore.ts'),
};

const resolveWithExtensions = (base) => {
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.jsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
};

const seamPlugin = {
  name: 'r094-seams',
  setup(b) {
    // The supabase seam fires even for relative imports (src/lib/repositories.ts
    // imports './supabase'), so it is matched by segment suffix, not by '@/' prefix.
    b.onResolve({ filter: /(^|[/.])supabase(\.(ts|tsx|js|mjs))?$/ }, (args) => {
      if (args.path === '@supabase/supabase-js' || args.path.includes('node_modules')) return null;
      if (args.importer.includes('node_modules')) return null;
      return { path: MOCK_MAP['@/lib/supabase'] };
    });
    b.onResolve({ filter: /^@/ }, (args) => {
      if (MOCK_MAP[args.path]) return { path: MOCK_MAP[args.path] };
      if (args.path.startsWith('@/')) {
        const found = resolveWithExtensions(join(root, 'src', args.path.slice(2)));
        if (found) return { path: found };
      }
      return null;
    });
  },
};

await build({
  entryPoints: [join(here, 'pages', 'harness.ts')],
  outdir: outDir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.env.MODE': '"production"',
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
  },
  plugins: [seamPlugin],
  logLevel: 'warning',
});
mkdirSync(outDir, { recursive: true });
copyFileSync(join(here, 'pages', 'harness.html'), join(outDir, 'harness.html'));
console.log(`r094 pages built → ${outDir}`);
