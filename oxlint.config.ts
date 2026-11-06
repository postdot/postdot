import { base } from '@tala-tools/oxlint'
import { defineConfig } from 'oxlint'

export default defineConfig({
    extends: [base],
    ignorePatterns: [
        'dist',
        'node_modules',
        'coverage',
        '.turbo',
        'build',
        '.vite',
        '**/routeTree.gen.ts',
    ],
    overrides: [
        {
            // Server persistence is asynchronous (ADR-097): a store call that is not awaited
            // silently loses ordering, errors and transaction scope. These
            // rules run only with `--type-aware` (db and api lint scripts).
            files: [
                'packages/db/**/*.ts',
                'apps/api/**/*.ts',
                'packages/auth/**/*.ts',
                'packages/core/**/*.ts',
            ],
            rules: {
                'typescript/no-floating-promises': 'error',
                'typescript/no-misused-promises': [
                    'error',
                    { checksVoidReturn: { attributes: false } },
                ],
                // Other default type-aware rules are out of this guard's scope;
                // await-thenable misreads bun:test `expect().rejects`.
                'typescript/await-thenable': 'off',
                'typescript/no-base-to-string': 'off',
                'typescript/no-misused-spread': 'off',
                'typescript/no-redundant-type-constituents': 'off',
                'typescript/require-array-sort-compare': 'off',
                'typescript/restrict-template-expressions': 'off',
                'typescript/unbound-method': 'off',
            },
        },
    ],
})
