import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import en from '../apps/web/messages/en.json' with { type: 'json' }

test('runs a separately served Studio against a production API without assets through HTTPS', async ({
    page,
    request,
}) => {
    test.setTimeout(90_000)
    const backend = `http://127.0.0.1:${process.env.POSTDOT_E2E_API_PORT}`
    await page.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'))
    for (const path of ['/', '/dashboard', '/assets/missing.js'])
        expect((await request.get(`${backend}${path}`)).status()).toBe(404)
    expect((await request.get(`${backend}/openapi/json`)).status()).toBe(200)
    const ready = await (await request.get(`${backend}/ready`)).json()
    expect(ready.status).toBe('ready')
    expect(ready.checks.scheduler).toBe('started')

    await page.goto('/')
    const origin = new URL(page.url()).origin
    expect(origin.startsWith('https://')).toBe(true)
    const email = `separate-${randomUUID()}@example.test`
    const password = 'separate-studio-test-password'
    const signup = await page.request.post('/api/auth/sign-up/email', {
        data: { name: 'API administrator', email, password },
        headers: { origin },
    })
    expect(signup.status()).toBe(200)
    const sessionCookie = (await page.context().cookies()).find(cookie =>
        cookie.name.endsWith('.session_token')
    )!
    expect(sessionCookie.httpOnly).toBe(true)
    expect(sessionCookie.secure).toBe(true)
    expect(sessionCookie.sameSite).toBe('Lax')
    const made = await page.request.post('/api/projects', { data: { name: 'Independent Studio' } })
    expect(made.status()).toBe(201)
    const { project } = await made.json()
    const base = `/api/projects/${project.id}`
    // Provision the machine credential with a human session, without using Studio.
    const createdKey = await page.request.post('/api/api-keys', {
        data: {
            name: 'Read-only integration',
            projectIds: [project.id],
            actionAccess: ['project:read'],
            expiresAt: Date.now() + 2 * 86400000,
        },
    })
    expect(createdKey.status()).toBe(201)
    const key = await createdKey.json()
    const authorization = { authorization: `Bearer ${key.token}` }
    expect((await request.get(`${base}/channels`, { headers: authorization })).status()).toBe(200)
    expect(
        (await request.post('/api/api-keys', { headers: authorization, data: {} })).status()
    ).toBe(403)
    expect(
        (
            await request.post(`${base}/channels`, {
                headers: authorization,
                data: { name: 'Denied' },
            })
        ).status()
    ).toBe(403)
    expect(
        (
            await page.request.post('/api/auth/update-user', {
                headers: { origin: 'https://untrusted.example' },
                data: { name: 'Denied origin' },
            })
        ).status()
    ).toBe(403)
    expect(
        (await page.request.post('/api/auth/sign-out', { data: {}, headers: { origin } })).status()
    ).toBe(200)
    expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull()
    // Exercise the actual production browser login through both proxy hops.
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto(`/dashboard/projects/${project.id}/performance`)
    await expect(
        page.getByRole('heading', { name: en.performance_title, exact: true })
    ).toBeVisible()
    expect((await request.get('/api/not-a-real-route')).status()).toBe(404)
    const callback = await page.request.get(
        `/api/oauth/facebook/callback?state=${'a'.repeat(32)}&code=invalid`,
        { maxRedirects: 0 }
    )
    expect(callback.status()).toBe(303)
    const returnUrl = new URL(callback.headers().location!)
    expect(returnUrl.origin).toBe(origin)
    expect(returnUrl.searchParams.get('publisher')).toBe('invalid_callback')

    const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    )
    const avatar = await page.request.post('/api/account/avatar', {
        data: image,
        headers: { origin, 'content-type': 'image/png' },
    })
    expect(avatar.status()).toBe(200)
    const { image: avatarUrl } = await avatar.json()
    const privateImage = await page.request.get(avatarUrl)
    expect(await privateImage.body()).toEqual(image)
    expect(privateImage.headers()['cache-control']).toBe('private, no-store')
    expect((await request.get(avatarUrl)).status()).toBe(401)

    const mediaBytes = Buffer.concat([image, Buffer.alloc(2 * 1024 * 1024)])
    const reserved = await page.request.post(`${base}/media/uploads`, {
        data: {
            originalFilename: 'proxy-upload.png',
            contentType: 'image/png',
            expectedSize: mediaBytes.byteLength,
        },
    })
    expect(reserved.status()).toBe(201)
    const reservation = await reserved.json()
    const uploadPath = `${base}/media/uploads/${reservation.intent.id}`
    expect(
        (
            await page.request.put(uploadPath, {
                data: mediaBytes,
                headers: { 'content-type': 'image/png' },
            })
        ).status()
    ).toBe(200)
    const finalized = await page.request.post(`${uploadPath}/finalize`)
    expect(finalized.status()).toBe(200)
    expect((await finalized.json()).status).toBe('ready')
    const contentPath = `${base}/media/${reservation.asset.id}/content`
    expect(await (await page.request.get(contentPath)).body()).toEqual(mediaBytes)
    expect((await request.get(contentPath)).status()).toBe(401)

    await page.evaluate(projectId => {
        const state = { opens: 0, updates: 0, errors: 0 }
        const stream = new EventSource(`/api/projects/${projectId}/events`, {
            withCredentials: true,
        })
        stream.onopen = () => state.opens++
        stream.onerror = () => state.errors++
        stream.addEventListener('project.update', () => state.updates++)
        Object.assign(window, { separateStudioStream: { state, stream } })
    }, project.id)
    const streamState = () =>
        page.evaluate(
            () =>
                (
                    window as unknown as {
                        separateStudioStream: {
                            state: { opens: number; updates: number; errors: number }
                        }
                    }
                ).separateStudioStream.state
        )
    await expect.poll(async () => (await streamState()).opens).toBe(1)
    const channel = await page.request.post(`${base}/channels`, { data: { name: 'Through proxy' } })
    expect(channel.status()).toBe(201)
    await expect.poll(async () => (await streamState()).updates).toBeGreaterThan(0)
    const interrupted = await request.post('/__realtime_tls_disconnect')
    expect(interrupted.status()).toBe(200)
    expect((await interrupted.json()).disconnected).toBeGreaterThan(0)
    await expect.poll(async () => (await streamState()).errors).toBeGreaterThan(0)
    await expect
        .poll(async () => (await streamState()).opens, { timeout: 15_000 })
        .toBeGreaterThan(1)

    const updatesBeforeWork = (await streamState()).updates
    const automaticChannel = await page.request.post(`${base}/channels`, {
        data: {
            name: 'Controlled worker destination',
            profile: {
                id: 'separate-studio-webhook',
                version: 1,
                origin: 'custom',
                contentSchema: {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
                    required: ['body'],
                    additionalProperties: false,
                },
                fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
                capabilities: {
                    revision: 'v1',
                    textFields: [
                        {
                            bindingId: 'body',
                            acceptedSourceFormats: ['plain_text'],
                            maxLength: 1000,
                        },
                    ],
                    mediaFields: [],
                    relations: [],
                },
                execution: {
                    kind: 'declarative_http',
                    contractId: 'separate-studio-webhook',
                    revision: 'v1',
                    mode: 'postdot_webhook',
                },
            },
        },
    })
    expect(automaticChannel.status()).toBe(201)
    const automaticId = (await automaticChannel.json()).channel.id
    const receiver = `http://127.0.0.1:${process.env.POSTDOT_E2E_RECEIVER_PORT}`
    expect(
        (
            await page.request.post(
                `${base}/channels/${automaticId}/publisher/custom-http/connect`,
                {
                    data: {
                        endpointUrl: receiver,
                        authentication: { kind: 'none' },
                        secret: 'separate-studio-webhook-secret-0123456789',
                    },
                }
            )
        ).ok()
    ).toBe(true)
    const scheduled = await page.request.post(`${base}/posts`, {
        data: {
            sourceContent: {
                body: { text: 'API-only scheduling', format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: automaticId,
                    deliveryMode: 'automatic',
                    targetContent: { body: 'API-only worker delivery' },
                    scheduledAt: Date.now() + 2000,
                },
            ],
        },
    })
    expect(scheduled.status()).toBe(201)
    const publicationId = (await scheduled.json()).publications[0].id
    await expect
        .poll(
            async () => {
                const observations = await (await request.get(`${receiver}/observations`)).json()
                return observations.requests.map(
                    (item: { body: { publication: { id: string } } }) => item.body.publication.id
                )
            },
            { timeout: 15_000 }
        )
        .toContain(publicationId)
    expect((await request.post(`${receiver}/release-all`)).status()).toBe(200)
    await expect
        .poll(
            async () => {
                const response = await page.request.get(
                    `${base}/publications/${publicationId}/editor`
                )
                expect(response.status()).toBe(200)
                return (await response.json()).editor.publication.state
            },
            { timeout: 15_000 }
        )
        .toBe('published')
    await expect.poll(async () => (await streamState()).updates).toBeGreaterThan(updatesBeforeWork)

    // Revoke the browser session from an independent HTTP client; keep its cookie
    // in the browser to prove server-side refusal, rather than local cookie removal.
    const cookie = (await page.context().cookies())
        .map(item => `${item.name}=${item.value}`)
        .join('; ')
    const errorsBeforeRevocation = (await streamState()).errors
    expect(
        (
            await request.post('/api/auth/sign-out', {
                headers: { cookie, origin },
                data: {},
            })
        ).status()
    ).toBe(200)
    expect((await page.request.get(`${base}/channels`)).status()).toBe(401)
    expect((await page.request.get(avatarUrl)).status()).toBe(401)
    await expect
        // Idle streams recheck session access at their existing 15-second heartbeat.
        .poll(async () => (await streamState()).errors, { timeout: 20_000 })
        .toBeGreaterThan(errorsBeforeRevocation)
    expect((await request.get(`${base}/channels`, { headers: authorization })).status()).toBe(200)
    await page.evaluate(() => {
        ;(
            window as unknown as { separateStudioStream: { stream: EventSource } }
        ).separateStudioStream.stream.close()
    })
})
