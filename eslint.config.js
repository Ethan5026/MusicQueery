import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/.wrangler/**', 'design/**', 'companion/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{js,mjs,ts}'],
    ignores: ['apps/web/src/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.js'],
    languageOptions: { globals: globals.audioWorklet },
  },
)
