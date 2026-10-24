import { afterAll, describe, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const workspace = await mkdtemp(join(tmpdir(), 'postdot-skills-'))
await cp(join(root, 'skills'), join(workspace, 'installed'), { recursive: true })
const prepare = join(workspace, 'installed/postdot-self-host/scripts/prepare.py')
const request = join(workspace, 'installed/postdot/scripts/request.py')
const token = 'synthetic-test-key'

async function run(script: string, args: string[], environment: Record<string, string> = {}) {
    const process = Bun.spawn(['python3', script, ...args], {
        cwd: workspace,
        env: { PATH: Bun.env.PATH, ...environment },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
    ])
    return { code, stdout, stderr }
}

afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
})

describe('installed self-host skill', () => {
    test('prepares a private pinned configuration without exposing or replacing secrets', async () => {
        const target = join(workspace, 'deployment')
        const result = await run(prepare, [target, '--origin', 'https://social.example.com'])
        expect(result.code).toBe(0)
        const config = await readFile(join(target, '.env'), 'utf8')
        const keys = [
            ...config.matchAll(
                /^(?:BETTER_AUTH_SECRET|POSTBOT_MEDIA_PUBLIC_URL_SECRET|POSTBOT_PUBLISHER_ENCRYPTION_KEY)=([a-f0-9]{64})$/gm
            ),
        ]
        expect(keys).toHaveLength(3)
        expect(new Set(keys.map(key => key[1])).size).toBe(3)
        for (const key of keys) expect(result.stdout + result.stderr).not.toContain(key[1]!)
        expect((await stat(join(target, '.env'))).mode & 0o777).toBe(0o600)
        expect(config).toContain(
            'POSTBOT_IMAGE=ghcr.io/postdot/postdot@sha256:690778f5d1af8f4a363406b989e17da8672fc764c6e62f9cca8e1a09c483638e'
        )
        expect(
            (await run(prepare, [target, '--origin', 'https://other.example.com'])).code
        ).not.toBe(0)
        expect(await readFile(join(target, '.env'), 'utf8')).toBe(config)
    })

    test('rejects symlink destinations and insecure public origins before writing', async () => {
        const destination = join(workspace, 'linked-deployment')
        await symlink(workspace, destination)
        expect(
            (await run(prepare, [destination, '--origin', 'https://social.example.com'])).code
        ).not.toBe(0)
        const target = join(workspace, 'unsafe')
        expect(
            (await run(prepare, [target, '--origin', 'http://public.example.com'])).code
        ).not.toBe(0)
        expect(await Bun.file(join(target, '.env')).exists()).toBe(false)
        expect((await run(prepare, [target, '--origin', 'http://127.0.0.1:3001'])).code).not.toBe(0)
    })

    test('bundled deployment assets match the maintained root templates', async () => {
        for (const name of ['compose.yaml', 'compose.env.example']) {
            expect(
                await readFile(join(workspace, 'installed/postdot-self-host/assets', name), 'utf8')
            ).toBe(await readFile(join(root, name), 'utf8'))
        }
    })
})

describe('installed API helper', () => {
    test('uses the selected instance and makes exactly one JSON write', async () => {
        const received: unknown[] = []
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            async fetch(req) {
                received.push({
                    method: req.method,
                    auth: req.headers.get('authorization'),
                    body: await req.json(),
                })
                return Response.json({ publication: { state: 'draft' } })
            },
        })
        try {
            const input = join(workspace, 'input.json')
            await writeFile(input, JSON.stringify({ title: 'Synthetic draft' }))
            const result = await run(
                request,
                ['POST', '/api/projects/example/posts', '--input', input],
                {
                    POSTBOT_URL: server.url.origin,
                    POSTBOT_API_KEY: token,
                }
            )
            expect(result.code).toBe(0)
            expect(JSON.parse(result.stdout).publication.state).toBe('draft')
            expect(received).toEqual([
                { method: 'POST', auth: `Bearer ${token}`, body: { title: 'Synthetic draft' } },
            ])
            expect(result.stdout + result.stderr).not.toContain(token)
        } finally {
            server.stop(true)
        }
    })

    test('does not follow redirects or repeat a failed write; omits arbitrary error text', async () => {
        let calls = 0
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch(req) {
                calls++
                if (new URL(req.url).pathname.endsWith('/redirect'))
                    return Response.redirect('/api/projects/leak', 307)
                return Response.json(
                    { error: { code: 'recovery_hold', message: token } },
                    { status: 503 }
                )
            },
        })
        try {
            const environment = { POSTBOT_URL: server.url.origin, POSTBOT_API_KEY: token }
            const redirect = await run(request, ['GET', '/api/projects/redirect'], environment)
            expect(redirect.code).toBe(1)
            expect(JSON.parse(redirect.stderr).error.status).toBe(307)
            expect(calls).toBe(1)
            const refused = await run(request, ['POST', '/api/projects/example/posts'], environment)
            expect(refused.code).toBe(1)
            expect(JSON.parse(refused.stderr).error.code).toBe('recovery_hold')
            expect(calls).toBe(2)
            expect(refused.stdout + refused.stderr).not.toContain(token)
        } finally {
            server.stop(true)
        }
    })

    test('rejects credential destinations, insecure remote HTTP and unrelated routes', async () => {
        for (const origin of [
            'http://public.example.com',
            'https://user:password@example.com',
            'https://example.com/path',
        ]) {
            const result = await run(request, ['GET', '/api/projects'], {
                POSTBOT_URL: origin,
                POSTBOT_API_KEY: token,
            })
            expect(result.code).toBe(2)
            expect(result.stderr).not.toContain(token)
        }
        for (const path of [
            'https://example.com/api/projects',
            '/api/projects/../auth',
            '/api/projects/%2e%2e/auth',
            '/api/api-keys',
        ]) {
            expect(
                (
                    await run(request, ['GET', path], {
                        POSTBOT_URL: 'https://example.com',
                        POSTBOT_API_KEY: token,
                    })
                ).code
            ).toBe(2)
        }
    })
})
