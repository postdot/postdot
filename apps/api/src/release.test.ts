import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readReleaseInfo } from './release'

it('uses only packaged release metadata and rejects corrupt identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-release-'))
    const filename = join(directory, 'release.json')
    try {
        expect(readReleaseInfo(pathToFileURL(filename))).toEqual({ version: null, revision: null })
        const identity = { version: '0.1.0-alpha.3', revision: 'a'.repeat(40) }
        await writeFile(filename, JSON.stringify(identity))
        expect(readReleaseInfo(pathToFileURL(filename))).toEqual(identity)
        await writeFile(filename, JSON.stringify({ version: 'latest', revision: 'main' }))
        expect(() => readReleaseInfo(pathToFileURL(filename))).toThrow('Invalid packaged')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

it('prints source build identity without server configuration or storage access', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-version-command-'))
    try {
        const result = Bun.spawn(
            [process.execPath, join(import.meta.dir, 'index.ts'), '--version', '--json'],
            {
                cwd: directory,
                env: {
                    ...process.env,
                    DB_FILE_NAME: '/unavailable/version-test.sqlite',
                    POSTDOT_VERSION: 'invented-runtime-version',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            }
        )
        expect(await result.exited).toBe(0)
        expect(JSON.parse(await new Response(result.stdout).text())).toEqual({
            version: null,
            revision: null,
        })
        expect(await new Response(result.stderr).text()).toBe('')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
