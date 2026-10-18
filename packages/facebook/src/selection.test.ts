import { expect, test } from 'bun:test'

import { createFacebookPublisher, FACEBOOK_PUBLISH_PERMISSIONS } from './publisher'

const token = 'synthetic-user-token'
const pageId = '1234567890'
const page = {
    id: pageId,
    name: 'Selected Page',
    access_token: 'synthetic-page-token',
    tasks: ['CREATE_CONTENT'],
}
const grants = FACEBOOK_PUBLISH_PERMISSIONS.map(permission => ({ permission, status: 'granted' }))
function setup(permissions: unknown, pages: unknown = { data: [page] }) {
    const calls: { url: URL; init: RequestInit | undefined }[] = []
    const publisher = createFacebookPublisher({
        fetcher: async (input, init) => {
            const url = new URL(String(input))
            calls.push({ url, init })
            return Response.json(url.pathname.endsWith('/me/permissions') ? permissions : pages)
        },
    })
    return { publisher, calls }
}

test('selection verifies current granted permissions before resolving the explicitly chosen Page', async () => {
    const { publisher, calls } = setup(
        { data: [...grants, { permission: 'email', status: 'declined' }] },
        { data: [{ ...page, id: '99' }, page] }
    )
    const result = await publisher.selectPage({ userToken: token, pageId, after: 'batch-two' })
    expect(result).toMatchObject({
        ok: true,
        value: {
            page: { id: pageId, accessToken: page.access_token },
            grantedPermissions: [...FACEBOOK_PUBLISH_PERMISSIONS].sort(),
        },
    })
    expect(calls.map(call => call.url.pathname)).toEqual([
        '/v26.0/me/permissions',
        '/v26.0/me/accounts',
    ])
    expect(calls[1]!.url.searchParams.get('after')).toBe('batch-two')
    for (const call of calls) {
        expect(call.init?.method).toBe('GET')
        expect(call.init?.headers).toMatchObject({ authorization: `Bearer ${token}` })
        expect(call.url.toString()).not.toContain(token)
        expect(call.init?.redirect).toBe('error')
    }
})

test('each missing, declined or expired required permission stops before reading Page tokens', async () => {
    for (const missing of FACEBOOK_PUBLISH_PERMISSIONS) {
        for (const status of ['declined', 'expired', null]) {
            const { publisher, calls } = setup({
                data: grants.flatMap(grant =>
                    grant.permission === missing
                        ? status === null
                            ? []
                            : [{ ...grant, status }]
                        : [grant]
                ),
            })
            const result = await publisher.selectPage({ userToken: token, pageId })
            expect(result).toMatchObject({
                ok: false,
                outcome: { code: 'permission_denied', effectOccurred: false },
            })
            expect(calls).toHaveLength(1)
            expect(JSON.stringify(result)).not.toContain(token)
            expect(JSON.stringify(result)).not.toContain(page.access_token)
        }
    }
})

test('missing Page or absent publish task never falls back to another accessible Page', async () => {
    for (const pages of [
        { data: [{ ...page, id: '99' }] },
        { data: [{ ...page, tasks: ['ANALYZE'] }] },
        { data: [] },
    ]) {
        const { publisher, calls } = setup({ data: grants }, pages)
        expect(await publisher.selectPage({ userToken: token, pageId })).toMatchObject({
            ok: false,
            outcome: { code: 'permission_denied' },
        })
        expect(calls).toHaveLength(2)
    }
})

test('partial, contradictory and malformed permission responses cannot authorize selection', async () => {
    for (const permissions of [
        { data: grants, paging: { next: 'https://attacker.test' } },
        { data: [...grants, { permission: 'pages_manage_posts', status: 'declined' }] },
        { data: [{ permission: 'pages_manage_posts', status: 'unknown' }] },
        { data: [{ permission: 'pages_manage_posts', status: ['granted'] }] },
        { data: [{ permission: 42, status: 'granted' }] },
        { data: 'granted' },
        { granted: FACEBOOK_PUBLISH_PERMISSIONS },
    ]) {
        const { publisher, calls } = setup(permissions)
        expect(await publisher.selectPage({ userToken: token, pageId })).toMatchObject({
            ok: false,
            outcome: { code: 'unavailable' },
        })
        expect(calls).toHaveLength(1)
    }
})

test('invalid selection and failed permission reads produce no Page discovery request', async () => {
    const { publisher, calls } = setup({ data: grants })
    expect(await publisher.selectPage({ userToken: token, pageId: '../me' })).toMatchObject({
        ok: false,
        outcome: { code: 'invalid_input' },
    })
    expect(await publisher.selectPage({ userToken: '', pageId })).toMatchObject({
        ok: false,
        outcome: { code: 'invalid_input' },
    })
    expect(await publisher.selectPage({ userToken: token, pageId, after: '\n' })).toMatchObject({
        ok: false,
        outcome: { code: 'invalid_input' },
    })
    expect(calls).toHaveLength(0)
    let reads = 0
    const unavailable = createFacebookPublisher({
        fetcher: async () => {
            reads++
            return Response.json({ error: { code: 190, message: token } }, { status: 400 })
        },
    })
    expect(await unavailable.selectPage({ userToken: token, pageId })).toMatchObject({
        ok: false,
        outcome: { code: 'authentication_required' },
    })
    expect(reads).toBe(1)
})
