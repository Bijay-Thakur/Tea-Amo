import fs from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';
import { Linter } from 'eslint';

// The owner workspace is made of classic scripts that intentionally share globals.
const ownerFiles = [
  'public/js/data/catalog.js', 'public/js/owner/app.js', 'public/js/owner/ops-ui.js',
  'public/js/owner/online.js', 'public/js/owner/navigation.js',
  'public/js/admin/cloud-bridge.js', 'public/js/admin/servers.js', 'public/js/ui/components.js'
];
const ownerGlobals = { TEA_AMO_CLOUD: 'readonly', openTable: 'readonly', TeaUI: 'readonly' };
const parser = new Linter();
for (const file of ownerFiles) {
  parser.verify(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), [{ languageOptions: { sourceType: 'script', ecmaVersion: 'latest' } }]);
  for (const variable of parser.getSourceCode()?.scopeManager.globalScope.variables || []) {
    if (variable.defs.length) ownerGlobals[variable.name] = 'writable';
  }
}

export default [
  { ignores: ['node_modules/**', '.vercel/**', '.wrangler/**', 'backups/**', 'public/vendor/**', 'reports/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.mjs', '**/*.cjs'], languageOptions: { globals: globals.node }, rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
  { files: ['public/js/**/*.js'], languageOptions: { globals: globals.browser }, rules: { 'no-unused-vars': 'off' } },
  { files: ownerFiles, languageOptions: { sourceType: 'script', globals: ownerGlobals }, rules: { 'no-redeclare': 'off', 'no-func-assign': 'off', 'no-useless-assignment': 'off', 'preserve-caught-error': 'off' } },
  { files: ['public/js/server/app.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, openTable: 'readonly', qty: 'readonly', addItem: 'readonly' } }, rules: { 'no-useless-assignment': 'off', 'no-redeclare': 'off' } }
];
