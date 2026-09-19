import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'local-backup/**', 'website', '.preview/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Entry points bootstrap the tree and intentionally export nothing.
  // Fast Refresh does not apply to them, so the only-export-components
  // rule is noise here (and fails CI after eslint-plugin-react-refresh bumps).
  {
    files: ['src/main.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
