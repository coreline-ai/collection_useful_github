import js from '@eslint/js'
import globals from 'globals'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/features/github',
              from: './src/features/youtube',
              message: 'Feature isolation: github feature cannot import youtube feature.',
            },
            {
              target: './src/features/github',
              from: './src/features/bookmark',
              message: 'Feature isolation: github feature cannot import bookmark feature.',
            },
            {
              target: './src/features/youtube',
              from: './src/features/github',
              message: 'Feature isolation: youtube feature cannot import github feature.',
            },
            {
              target: './src/features/youtube',
              from: './src/features/bookmark',
              message: 'Feature isolation: youtube feature cannot import bookmark feature.',
            },
            {
              target: './src/features/bookmark',
              from: './src/features/github',
              message: 'Feature isolation: bookmark feature cannot import github feature.',
            },
            {
              target: './src/features/bookmark',
              from: './src/features/youtube',
              message: 'Feature isolation: bookmark feature cannot import youtube feature.',
            },
          ],
        },
      ],
    },
  },
])
