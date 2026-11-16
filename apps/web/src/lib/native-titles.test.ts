import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')
const nativeTitle =
    /<[a-z][\w.-]*\b(?:[^>"'{]|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*?\s+title\s*=/

test('intrinsic JSX elements use shared tooltips instead of native titles', () => {
    const files = execFileSync('git', ['ls-files', 'apps/web/src', 'packages/ui/src'], {
        cwd: root,
        encoding: 'utf8',
    })
        .trim()
        .split('\n')
    const offenders = files.filter(
        file => file.endsWith('.tsx') && nativeTitle.test(readFileSync(resolve(root, file), 'utf8'))
    )
    expect(offenders).toEqual([])
})
