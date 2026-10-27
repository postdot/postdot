import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    acquireRuntimeQuiescenceLock,
    closeDatabase,
    createDatabase,
    runMigrations,
} from '@postdot/db'
import { createLocalMediaStore } from '@postdot/media'

import { runMaintenanceCommand } from './maintenance'

it('runs preview maintenance only against an existing offline database and releases its lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-preview-maintenance-'))
    const databaseFileName = join(directory, 'postdot.sqlite')
    const mediaStore = createLocalMediaStore({
        storeId: 'local-default',
        rootDirectory: join(directory, 'media'),
        maxObjectBytes: 2_000_000,
    })
    const options = { databaseFileName, mediaStore }
    try {
        await expect(runMaintenanceCommand(['media-previews'], options)).rejects.toThrow()
        expect(await Bun.file(databaseFileName).exists()).toBe(false)
        const database = createDatabase(databaseFileName)
        runMigrations(database)
        closeDatabase(database)
        const runtime = acquireRuntimeQuiescenceLock(databaseFileName, 'server')
        try {
            await expect(runMaintenanceCommand(['media-previews'], options)).rejects.toThrow(
                'already held'
            )
        } finally {
            runtime.release()
        }
        await expect(
            runMaintenanceCommand(['media-previews', '--project'], options)
        ).rejects.toThrow('Missing required option')
        expect(await runMaintenanceCommand(['media-previews', '--dry-run'], options)).toBe(true)
        expect(await Bun.file(`${databaseFileName}.runtime.lock`).exists()).toBe(false)
        expect(await runMaintenanceCommand(['media-previews'], options)).toBe(true)
        expect(await Bun.file(`${databaseFileName}.runtime.lock`).exists()).toBe(false)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

for (const command of ['', 'backup', 'restore', 'recovery', 'media-previews', 'account']) {
    for (const flag of ['--help', '-h']) {
        it(`shows ${command || 'global'} ${flag} without configuration, storage access or account prompts`, async () => {
            const directory = await mkdtemp(join(tmpdir(), 'postdot-maintenance-help-'))
            try {
                const child = Bun.spawn(
                    [
                        process.execPath,
                        new URL('./index.ts', import.meta.url).pathname,
                        ...(command ? [command] : []),
                        flag,
                    ],
                    {
                        cwd: directory,
                        env: {
                            PATH: process.env.PATH,
                            POSTDOT_MEDIA_STORE: 'invalid-help-must-ignore-config',
                            DB_FILE_NAME: join(directory, 'must-not-exist.sqlite'),
                        },
                        stdin: 'ignore',
                        stdout: 'pipe',
                        stderr: 'pipe',
                    }
                )
                try {
                    const [stdout, stderr, exitCode] = await Promise.all([
                        new Response(child.stdout).text(),
                        new Response(child.stderr).text(),
                        child.exited,
                    ])
                    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
                    expect(stdout).toContain(`Usage: bun /app/postdot.js ${command}`)
                    if (command === '') {
                        for (const name of [
                            'backup',
                            'restore',
                            'recovery',
                            'media-previews',
                            'account',
                        ]) {
                            expect(stdout).toContain(name)
                        }
                    }
                    expect(
                        await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: directory }))
                    ).toEqual([])
                } finally {
                    child.kill()
                }
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
}
