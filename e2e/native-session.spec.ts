import type { IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'

import { expect, test } from '@playwright/test'

// No browser or automatic cookie jar: this probe models the native HTTP wire
// contract. Trust only the isolated loopback proxy's generated test certificate.
test('uses an explicit native session over HTTPS with private media, SSE and revocation', async ({
    baseURL,
}) => {
    test.setTimeout(60_000)
    const origin = new URL(baseURL!).origin
    expect(new URL(origin).hostname).toBe('127.0.0.1')
    expect(new URL(origin).protocol).toBe('https:')
    type Reply = { status: number; headers: IncomingHttpHeaders; body: Buffer }
    function send(
        path: string,
        cookie = '',
        data?: unknown,
        extra: Record<string, string> = {}
    ): Promise<Reply> {
        const target = new URL(path, origin)
        if (target.origin !== origin) throw new Error('Native probe refuses another server')
        const body =
            data === undefined
                ? undefined
                : Buffer.isBuffer(data)
                  ? data
                  : Buffer.from(JSON.stringify(data))
        return new Promise((resolve, reject) => {
            const request = httpsRequest(
                target,
                {
                    rejectUnauthorized: false,
                    method: data === undefined ? 'GET' : 'POST',
                    headers: {
                        origin,
                        ...(cookie ? { cookie } : {}),
                        ...(body
                            ? {
                                  'content-type': 'application/json',
                                  'content-length': String(body.byteLength),
                              }
                            : {}),
                        ...extra,
                    },
                },
                response => {
                    const chunks: Buffer[] = []
                    response.on('data', chunk => chunks.push(Buffer.from(chunk)))
                    response.on('error', reject)
                    response.on('end', () =>
                        resolve({
                            status: response.statusCode!,
                            headers: response.headers,
                            body: Buffer.concat(chunks),
                        })
                    )
                }
            )
            request.on('error', reject)
            request.end(body)
        })
    }
    const sessionCookie = (reply: Reply) =>
        reply.headers['set-cookie']!.find(value =>
            value.split('=', 1)[0]!.endsWith('.session_token')
        )!.split(';', 1)[0]!
    const json = (reply: Reply) => JSON.parse(reply.body.toString())
    const credentials = {
        email: 'native-https@example.test',
        password: 'native-https-test-password',
    }
    const signup = await send('/api/auth/sign-up/email', '', {
        ...credentials,
        name: 'Native HTTP operator',
    })
    expect(signup.status).toBe(200)
    const browserCookie = sessionCookie(signup)
    const signedIn = await send('/api/auth/sign-in/email', '', credentials)
    expect(signedIn.status).toBe(200)
    const cookie = sessionCookie(signedIn)
    expect(cookie).not.toBe(browserCookie)
    expect(
        signedIn.headers['set-cookie']!.some(
            value =>
                value.includes('HttpOnly') &&
                value.includes('Secure') &&
                value.includes('SameSite=Lax')
        )
    ).toBe(true)
    expect(json(await send('/api/auth/get-session', cookie)).user.email).toBe(credentials.email)
    expect(
        (
            await send(
                '/api/auth/update-user',
                cookie,
                { name: 'Denied' },
                { origin: 'https://untrusted.example' }
            )
        ).status
    ).toBe(403)
    const made = await send('/api/projects', cookie, { name: 'Native HTTPS desk' })
    expect(made.status).toBe(201)
    const projectId = json(made).project.id
    const base = `/api/projects/${projectId}`
    expect((await send(`${base}/channels`)).status).toBe(401)
    expect((await send(`${base}/channels`, cookie)).status).toBe(200)
    expect(
        (
            await send(`${base}/channels`, '', undefined, {
                authorization: `Bearer ${json(signedIn).token}`,
            })
        ).status
    ).toBe(401)

    const avatarBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    )
    const avatar = await send('/api/account/avatar', cookie, avatarBytes, {
        'content-type': 'image/png',
    })
    expect(avatar.status).toBe(200)
    const avatarPath = json(avatar).image
    const privateImage = await send(avatarPath, cookie)
    expect(privateImage.status).toBe(200)
    expect(privateImage.body).toEqual(avatarBytes)
    expect(privateImage.headers['cache-control']).toBe('private, no-store')
    expect((await send(avatarPath)).status).toBe(401)

    const stream = { status: 0, text: '', closed: false }
    const connection = httpsRequest(
        new URL(`${base}/events`, origin),
        { rejectUnauthorized: false, headers: { cookie } },
        response => {
            stream.status = response.statusCode!
            response.on('data', chunk => {
                stream.text += chunk.toString()
            })
            response.on('close', () => {
                stream.closed = true
            })
            response.on('error', () => {
                stream.closed = true
            })
        }
    )
    connection.on('error', () => {
        stream.closed = true
    })
    connection.end()
    try {
        await expect.poll(() => stream.status).toBe(200)
        await expect.poll(() => stream.text).toContain(': connected')
        const channel = await send(`${base}/channels`, cookie, { name: 'Native change' })
        expect(channel.status).toBe(201)
        await expect.poll(() => stream.text).toContain('event: project.update')
        await expect.poll(() => stream.text).toContain(json(channel).channel.id)
        const key = await send('/api/api-keys', cookie, {
            name: 'Native-created key',
            projectIds: [projectId],
            actionAccess: ['project:read'],
        })
        expect(key.status).toBe(201)
        expect(
            (
                await send('/api/api-keys', '', undefined, {
                    authorization: `Bearer ${json(key).token}`,
                })
            ).status
        ).toBe(403)
        // Revoke from another transport while retaining the native cookie locally.
        const revoked = await send('/api/auth/revoke-session', browserCookie, {
            token: json(signedIn).token,
        })
        expect(revoked.status).toBe(200)
        expect((await send(`${base}/channels`, cookie)).status).toBe(401)
        expect((await send(avatarPath, cookie)).status).toBe(401)
        expect(json(await send('/api/auth/get-session', cookie))).toBeNull()
        await expect
            .poll(() => stream.text, { timeout: 20_000 })
            .toContain('project.access-revoked')
        await expect.poll(() => stream.closed).toBe(true)
        expect((await send(`${base}/channels`, browserCookie)).status).toBe(200)
        expect((await send('/api/auth/sign-out', browserCookie, {})).status).toBe(200)
        expect((await send(`${base}/channels`, browserCookie)).status).toBe(401)
    } finally {
        connection.destroy()
    }
})
