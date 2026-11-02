import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliQualificationFixture } from './cli-qualification-fixture'

/** Owns only an isolated published-image instance; never connects a provider. */
export async function createContainerCliFixture(
    directory: string,
    image: string
): Promise<CliQualificationFixture> {
    assert.match(image, /^ghcr\.io\/postdot\/postdot@sha256:[a-f0-9]{64}$/)
    const name = `postdot-cli-acceptance-${randomUUID()}`
    const data = join(directory, 'container-data')
    await mkdir(data)
    await chmod(data, 0o777)
    const environment = join(directory, 'container.env')
    const configuration = {
        BETTER_AUTH_URL: 'http://localhost:3000',
        POSTDOT_WEB_ORIGIN: 'http://localhost:3000',
        BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
        POSTDOT_MEDIA_PUBLIC_URL_SECRET: randomBytes(32).toString('hex'),
        POSTDOT_PUBLISHER_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        POSTDOT_MEDIA_DIRECTORY: '/data/media',
        LOG_LEVEL: 'error',
    }
    await Bun.write(
        environment,
        Object.entries(configuration)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
    )
    await chmod(environment, 0o600)
    async function docker(args: string[]) {
        const process = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
        const [stdout, stderr, status] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
        ])
        assert.equal(status, 0, `Docker ${args[0]} failed: ${stderr}`)
        return stdout.trim()
    }
    let started = false
    async function stop() {
        if (!started) return
        await docker(['rm', '--force', name])
        started = false
    }
    try {
        await docker(['pull', image])
        const metadata = JSON.parse(await docker(['image', 'inspect', image]))[0]
        assert.equal(
            await docker(['version', '--format', '{{.Server.Arch}}']),
            metadata.Architecture,
            'Container acceptance requires a native host'
        )
        await docker([
            'run',
            '--detach',
            '--name',
            name,
            '--user',
            `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
            '--publish',
            '127.0.0.1::3000',
            '--env-file',
            environment,
            '--volume',
            `${data}:/data`,
            image,
        ])
        started = true
        const address = await docker(['port', name, '3000/tcp'])
        const url = new URL(`http://${address}/`)
        let ready = false
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                ready = (await fetch(new URL('ready', url), { signal: AbortSignal.timeout(1000) }))
                    .ok
            } catch {
                /* Wait for isolated startup. */
            }
            if (ready) break
            await Bun.sleep(100)
        }
        assert.ok(ready, 'Published container did not become ready')
        const identity = await (await fetch(new URL('api/version', url))).json()
        assert.equal(identity.revision, metadata.Config.Labels['org.opencontainers.image.revision'])
        assert.equal(identity.version, metadata.Config.Labels['org.opencontainers.image.version'])
        console.log(
            `Published server ${identity.version}, revision ${identity.revision}, ${metadata.Architecture}, image ${image}`
        )
        return {
            url,
            handle: (request: Request) => {
                const target = new URL(request.url)
                target.host = url.host
                return fetch(new Request(target, request))
            },
            stop,
        }
    } catch (error) {
        await stop()
        throw error
    }
}
