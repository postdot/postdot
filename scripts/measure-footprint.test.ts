import { expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const overBudget of [false, true]) {
    it(`checks the named anonymous graph ${overBudget ? 'above' : 'below'} its unchanged budget`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'postdot-web-budget-'))
        const dist = join(directory, 'apps/web/dist')
        try {
            await mkdir(join(dist, '.vite'), { recursive: true })
            await writeFile(
                join(dist, '.vite/manifest.json'),
                JSON.stringify({
                    'index.html': {
                        file: 'entry.js',
                        isEntry: true,
                        imports: ['shared'],
                        dynamicImports: ['dashboard'],
                    },
                    'src/routes/login.tsx?tsr-split=component': {
                        file: 'login.js',
                        imports: ['shared'],
                    },
                    shared: { file: 'shared.js' },
                    dashboard: { file: 'dashboard.js' },
                })
            )
            await writeFile(join(dist, 'entry.js'), overBudget ? randomBytes(200 * 1024) : 'entry')
            await writeFile(join(dist, 'login.js'), 'login')
            await writeFile(join(dist, 'shared.js'), 'shared')
            // No dashboard file: dynamic imports must not be counted or read.
            const child = Bun.spawn(
                [
                    process.execPath,
                    join(import.meta.dir, 'measure-footprint.ts'),
                    '--web-only',
                    '--check',
                ],
                { cwd: directory, stdout: 'pipe', stderr: 'pipe' }
            )
            const output = await new Response(child.stdout).text()
            expect(await child.exited).toBe(overBudget ? 1 : 0)
            expect(await new Response(child.stderr).text()).toBe('')
            const report = JSON.parse(output)
            expect(report.entryScreen).toBe('/login')
            expect(report.files).toEqual(['entry.js', 'login.js', 'shared.js'])
            expect(report.withinBudget).toBe(!overBudget)
            expect(report.budgetGzipBytes).toBe(180 * 1024)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
}
