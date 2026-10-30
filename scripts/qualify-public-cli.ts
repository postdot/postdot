import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createPostdotClient } from '@postdot/client'

import { createApp, createPublisherRuntime } from '../apps/api/src/index'
import { createAuth } from '../packages/auth/src/index'
import { result } from '../packages/cli/src/context'
import {
    closeDatabase,
    createDatabase,
    createMediaAssetStore,
    runMigrations,
} from '../packages/db/src/index'
import { createLocalMediaStore } from '../packages/media/src/index'

// This acceptance tool owns its temporary installation, server and database.
// It exercises the actual npm artifact and executable, not a source-only import.
const root = resolve(import.meta.dir, '..')
const directory = await mkdtemp(join(tmpdir(), 'postdot-cli-distribution-'))
const database = createDatabase(':memory:')
runMigrations(database)
const media = createMediaAssetStore(
    database,
    createLocalMediaStore({
        rootDirectory: join(directory, 'objects'),
        storeId: 'cli-distribution',
        maxObjectBytes: 2_000_000,
    })
)
const app = createApp({
    database,
    media,
    publisher: createPublisherRuntime(database, {
        apiOrigin: 'http://localhost:3000',
        webOrigin: 'http://localhost:5173',
        publisherEncryptionKey: new Uint8Array(32).fill(7),
        publisherEncryptionKeyId: 'cli-distribution',
    }),
    auth: createAuth(database, {
        baseURL: 'http://localhost:3000',
        secret: 'postdot-cli-distribution-secret-long-enough',
    }),
})
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app.handle(request) })

async function child(command: string[], cwd: string, environment: Record<string, string> = {}) {
    const process = Bun.spawn(command, {
        cwd,
        env: { PATH: Bun.env.PATH, ...environment },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, status] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
    ])
    assert.equal(status, 0, `Command failed (${command[0]}): ${stderr}`)
    return stdout
}

try {
    await child([process.execPath, 'run', '--cwd', 'packages/cli', 'build'], root)
    await child([process.execPath, 'run', '--cwd', 'packages/cli', 'build:executable'], root)
    await child(
        ['npm', 'pack', '--pack-destination', directory, '--json'],
        join(root, 'packages/cli')
    )
    const tarball = (await readdir(directory)).find(name => name.endsWith('.tgz'))
    assert.ok(tarball)
    const installed = join(directory, 'installation')
    await child(
        [
            'npm',
            'install',
            '--prefix',
            installed,
            join(directory, tarball),
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
        ],
        directory
    )
    const js = join(installed, 'node_modules/@postdot/cli/dist/cli.js')
    const native = join(directory, process.platform === 'win32' ? 'postdot.exe' : 'postdot')
    await copyFile(
        join(root, 'packages/cli/dist', process.platform === 'win32' ? 'postdot.exe' : 'postdot'),
        native
    )
    const signup = await app.handle(
        new Request('http://localhost:3000/api/auth/sign-up/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
            body: JSON.stringify({
                name: 'CLI acceptance',
                email: 'cli-distribution@example.test',
                password: 'correct-horse-battery-staple',
            }),
        })
    )
    assert.equal(signup.status, 200)
    const cookie = signup.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)
    const client = createPostdotClient(server.url.href, { cookie })
    const { project } = await result(client.api.projects.post({ name: 'Distribution acceptance' }))
    const { token } = await result(
        client.api['api-keys'].post({ name: 'Distribution', projectIds: [project.id] })
    )
    const file = join(directory, 'pixel.png')
    await Bun.write(
        file,
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ZkAAAAASUVORK5CYII=',
            'base64'
        )
    )
    const environment = { POSTDOT_URL: server.url.origin, POSTDOT_API_KEY: token }
    const node = Bun.which('node')
    assert.ok(node, 'Node is required to qualify the optional compatibility artifact')
    const runtimes = [
        { name: 'bun-javascript', command: [process.execPath, js] },
        { name: 'standalone-bun', command: [native] },
        { name: 'node-javascript', command: [node, js] },
    ]
    for (const runtime of runtimes) {
        // The standalone invocation can run with no runtime available on PATH.
        const env = {
            ...environment,
            ...(runtime.name === 'standalone-bun' ? { PATH: directory } : {}),
        }
        const listed = JSON.parse(
            await child([...runtime.command, 'projects', 'list', '--json'], directory, env)
        )
        assert.ok(listed.projects.some((item: { id: string }) => item.id === project.id))
        const uploaded = JSON.parse(
            await child(
                [
                    ...runtime.command,
                    'media',
                    'upload',
                    '--project',
                    project.id,
                    '--file',
                    file,
                    '--content-type',
                    'image/png',
                    '--json',
                ],
                directory,
                env
            )
        )
        assert.equal(uploaded.status, 'ready')
        assert.ok(uploaded.media.asset.id)
        const stored = await result(
            client.api
                .projects({ projectId: project.id })
                .media({ assetId: uploaded.media.asset.id })
                .get()
        )
        assert.equal(stored.asset.state, 'ready')
        const content = await fetch(
            `${server.url}api/projects/${project.id}/media/${uploaded.media.asset.id}/content`,
            { headers: { authorization: `Bearer ${token}` } }
        )
        assert.equal(content.status, 200)
        assert.deepEqual(
            new Uint8Array(await content.arrayBuffer()),
            new Uint8Array(await Bun.file(file).arrayBuffer())
        )
        console.log(`${runtime.name}: installed remote discovery and media upload passed`)
    }
    const help = await child([native, 'media', 'upload', '--help'], directory, { PATH: directory })
    assert.ok(help.includes('--project <id>'))
    const packageManifest = await Bun.file(
        join(installed, 'node_modules/@postdot/cli/package.json')
    ).json()
    assert.equal(packageManifest.dependencies, undefined)
    console.log(
        'Standalone help works without credentials or an installed runtime; npm artifact has no runtime workspace dependencies.'
    )
} finally {
    await server.stop(true)
    closeDatabase(database)
    await rm(directory, { recursive: true, force: true })
}
