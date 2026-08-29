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
})
