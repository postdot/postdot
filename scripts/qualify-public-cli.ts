import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
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
import { qualifyPublications, qualifyUncertainWrite } from './cli-publication-acceptance'

// This acceptance tool owns its temporary installation, server and database.
// It exercises the actual npm artifact and executable, not a source-only import.
const root = resolve(import.meta.dir, '..')
const standalone = process.argv.includes('--standalone')
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
const clock = Date.now()
const app = createApp({
    manualStore: { now: () => clock },
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

async function child(
    command: string[],
    cwd: string,
    environment: Record<string, string> = {},
    options: { input?: string; expectedStatus?: number } = {}
) {
    const process = Bun.spawn(command, {
        cwd,
        env: { PATH: Bun.env.PATH, ...environment },
        stdin: options.input === undefined ? 'ignore' : new Blob([options.input]),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, status] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
    ])
    assert.equal(status, options.expectedStatus ?? 0, `Command failed (${command[0]}): ${stderr}`)
    if (options.expectedStatus) {
        assert.equal(stdout, '', 'A failed command must not write a result to stdout')
        return stderr
    }
    return stdout
}

try {
    await child([process.execPath, 'run', '--cwd', 'packages/cli', 'build'], root)
    if (standalone)
        await child([process.execPath, 'run', '--cwd', 'packages/cli', 'build:executable'], root)
    await child([Bun.which('node') ?? 'node', 'integrations/scripts/prepare-cli.mjs'], root)
    await child(
        ['npm', 'pack', '--pack-destination', directory, '--json'],
        join(root, 'integrations/cli')
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
    if (standalone)
        await copyFile(
            join(
                root,
                'packages/cli/dist',
                process.platform === 'win32' ? 'postdot.exe' : 'postdot'
            ),
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
    const installedBin = join(installed, 'node_modules/.bin/postdot')
    const binEnvironment = { ...environment, POSTDOT_CONFIG_DIR: join(directory, 'bin-config') }
    const fromBin = JSON.parse(
        await child([installedBin, 'projects', 'list', '--json'], directory, binEnvironment)
    )
    assert.ok(fromBin.projects.some((item: { id: string }) => item.id === project.id))
    const bunOnlyBin = JSON.parse(
        await child(
            [process.execPath, 'run', '--bun', installedBin, 'projects', 'list', '--json'],
            directory,
            { ...binEnvironment, PATH: directory }
        )
    )
    assert.ok(bunOnlyBin.projects.some((item: { id: string }) => item.id === project.id))

    const node = process.env.POSTDOT_CLI_NODE ?? Bun.which('node')
    assert.ok(node, 'Node is required to qualify the JavaScript package compatibility')
    const runtimes = [
        { name: 'bun-javascript', command: [process.execPath, js] },
        ...(standalone ? [{ name: 'standalone-bun', command: [native] }] : []),
        { name: 'node-javascript', command: [node, js] },
        ...(process.argv.includes('--node24-container') ||
        process.env.POSTDOT_CLI_RUNTIME === 'node24-container'
            ? [
                  {
                      name: 'node24-container',
                      command: [
                          'docker',
                          'run',
                          '--rm',
                          '--interactive',
                          '--network',
                          'host',
                          '--user',
                          `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
                          '--mount',
                          `type=bind,source=${directory},target=${directory}`,
                          '--workdir',
                          directory,
                          '--env',
                          'POSTDOT_URL',
                          '--env',
                          'POSTDOT_API_KEY',
                          '--env',
                          'POSTDOT_CONFIG_DIR',
                          'node:24-slim',
                          'node',
                          js,
                      ],
                  },
              ]
            : []),
    ]
    const selectedRuntime = process.env.POSTDOT_CLI_RUNTIME
    if (selectedRuntime && !runtimes.some(runtime => runtime.name === selectedRuntime))
        throw new Error('Unknown CLI qualification runtime')
    for (const runtime of runtimes.filter(
        runtime => !selectedRuntime || runtime.name === selectedRuntime
    )) {
        // The standalone invocation can run with no runtime available on PATH.
        const env = {
            ...environment,
            POSTDOT_CONFIG_DIR: join(directory, `automation-${runtime.name}`),
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
        assert.equal(await Bun.file(join(env.POSTDOT_CONFIG_DIR, 'config.json')).exists(), false)

        const configDir = join(directory, `profiles-${runtime.name}`)
        const profileEnvironment = { POSTDOT_CONFIG_DIR: configDir }
        const invoke = (
            args: string[],
            options: { input?: string; expectedStatus?: number } = {}
        ) => child([...runtime.command, ...args, '--json'], directory, profileEnvironment, options)
        await invoke(['config', 'add', 'work', '--url', server.url.origin, '--project', project.id])
        const loggedIn = await invoke(['auth', 'login', '--token-stdin'], { input: `${token}\n` })
        assert.equal(JSON.parse(loggedIn).authenticated, true)
        assert.ok(!loggedIn.includes(token))
        const credentialsBefore = await Bun.file(join(configDir, 'credentials.json')).text()
        assert.equal((await stat(join(configDir, 'credentials.json'))).mode & 0o777, 0o600)
        const status = await invoke(['auth', 'status'])
        assert.equal(JSON.parse(status).credentialSource, 'profile')
        assert.ok(!status.includes(token))
        const policy = JSON.parse(await invoke(['media', 'policy']))
        assert.ok(policy.maxFileSize > 0)
        const machine = (
            args: string[],
            options: { input?: string; expectedStatus?: number } = {}
        ) => child([...runtime.command, ...args, '--json'], directory, env, options)
        const workflow = await qualifyPublications({
            invoke,
            client,
            projectId: project.id,
            assetId: uploaded.media.asset.id,
            directory,
            label: runtime.name,
            now: () => clock,
        })
        const deniedWrite = JSON.parse(
            await child(
                [
                    ...runtime.command,
                    'posts',
                    'create',
                    '--project',
                    project.id,
                    '--input',
                    '-',
                    '--json',
                ],
                directory,
                { ...env, POSTDOT_API_KEY: workflow.readOnlyToken },
                { input: JSON.stringify(workflow.postInput), expectedStatus: 3 }
            )
        )
        assert.equal(deniedWrite.error.details.status, 403)
        await qualifyUncertainWrite(machine, project.id)

        const invalidFile = join(directory, `invalid-${runtime.name}.png`)
        await Bun.write(invalidFile, 'This is not an image')
        const uploadArguments = [
            'media',
            'upload',
            '--file',
            invalidFile,
            '--content-type',
            'image/png',
        ]
        const failedUpload = JSON.parse(await invoke(uploadArguments, { expectedStatus: 1 }))
        assert.ok(failedUpload.error.details.assetId)
        assert.ok(failedUpload.error.details.intentId)
        const humanUploadFailure = await child(
            [...runtime.command, ...uploadArguments],
            directory,
            profileEnvironment,
            { expectedStatus: 1 }
        )
        assert.ok(humanUploadFailure.includes('"assetId"'))
        assert.ok(humanUploadFailure.includes('"intentId"'))

        const denied = JSON.parse(
            await invoke(['auth', 'login', '--token-stdin'], {
                input: 'invalid-key',
                expectedStatus: 3,
            })
        )
        assert.ok(denied.error.code)
        assert.equal(await Bun.file(join(configDir, 'credentials.json')).text(), credentialsBefore)
        await invoke(['auth', 'login', '--token-stdin'], {
            input: 'x'.repeat(16_385),
            expectedStatus: 2,
        })
        assert.equal(await Bun.file(join(configDir, 'credentials.json')).text(), credentialsBefore)
        await invoke(['auth', 'login'], { expectedStatus: 2 })
        const listedProfiles = await invoke(['config', 'list'])
        assert.ok(!listedProfiles.includes(token))
        let unexpectedRequests = 0
        const otherServer = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch() {
                unexpectedRequests++
                return Response.json({ projects: [] })
            },
        })
        try {
            const mismatch = JSON.parse(
                await invoke(['projects', 'list', '--base-url', otherServer.url.origin], {
                    expectedStatus: 3,
                })
            )
            assert.equal(mismatch.error.code, 'authentication_required')
            assert.equal(unexpectedRequests, 0)
        } finally {
            await otherServer.stop(true)
        }
        const loggedOut = JSON.parse(await invoke(['auth', 'logout']))
        assert.equal(loggedOut.removed, true)
        assert.ok(!(await Bun.file(join(configDir, 'credentials.json')).text()).includes(token))
        await invoke(['auth', 'status'], { expectedStatus: 3 })
        const environmentStatus = JSON.parse(
            await child([...runtime.command, 'auth', 'status', '--json'], directory, {
                ...profileEnvironment,
                POSTDOT_API_KEY: token,
            })
        )
        assert.equal(environmentStatus.credentialSource, 'environment')
        console.log(
            `${runtime.name}: installed remote publication workflow, uploads, saved profiles and credential isolation passed`
        )
    }
    const help = await child(
        [...(standalone ? [native] : [process.execPath, js]), 'media', 'upload', '--help'],
        directory,
        { PATH: directory }
    )
    assert.ok(help.includes('--project <id>'))
    const packageManifest = await Bun.file(
        join(installed, 'node_modules/@postdot/cli/package.json')
    ).json()
    assert.equal(packageManifest.dependencies, undefined)
    console.log(
        'Help works without credentials or network; the npm artifact has no runtime workspace dependencies.'
    )
} finally {
    await server.stop(true)
    closeDatabase(database)
    await rm(directory, { recursive: true, force: true })
}
