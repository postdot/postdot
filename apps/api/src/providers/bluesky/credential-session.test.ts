import { expect, it } from 'bun:test'

import {
    createBlueskyLoopbackClientMetadata,
    createBlueskyRuntimeImplementation,
    serializeBlueskySession,
} from '@postdot/bluesky'
import {
    closeDatabase,
    createDatabase,
    createManualStore,
    createPublisherCredentialCipher,
    createPublisherCredentialStore,
    runMigrations,
} from '@postdot/db'
import { seedTestWorkspace } from '@postdot/db/testing'

import { restoreCredentialBlueskySession } from './credential-session'

it('coordinates the real SDK across sessions and persists implicit later renewals before releasing ownership', async () => {
    const database = createDatabase(':memory:')
    runMigrations(database)
    try {
        const project = createManualStore(database).createProject({
            workspaceId: seedTestWorkspace(database),
            name: 'Session fixture',
            subjectId: 'owner',
            displayName: 'Owner',
        })
        const credentials = createPublisherCredentialStore(database, {
            cipher: createPublisherCredentialCipher({
                keyId: 'test',
                key: new Uint8Array(32).fill(1),
            }),
        })
        const accountId = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
        const key = await createBlueskyRuntimeImplementation().createKey(['ES256'])
        const session: Parameters<typeof serializeBlueskySession>[0] = {
            dpopKey: key,
            authMethod: { method: 'none' as const },
            tokenSet: {
                iss: 'https://auth.example.test',
                sub: accountId,
                aud: 'https://pds.example.test',
                scope: 'atproto',
                access_token: 'expired-access',
                refresh_token: 'single-use-0',
                token_type: 'DPoP' as const,
                expires_at: new Date(Date.now() - 60000).toISOString(),
            },
        }
        const created = await credentials.createPublisherCredential({
            projectId: project.project.id,
            connectedByActorId: project.actor.id,
            providerId: 'bluesky',
            externalAccountId: accountId,
            accessToken: 'expired-access',
            refreshToken: 'single-use-0',
            providerSession: serializeBlueskySession(session),
            expiresAt: Date.now() - 60000,
        })
        if (created.kind !== 'created') throw new Error('Missing credential')
        let renewals = 0
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        const reconnectDuringRenewal = Promise.withResolvers<void>()
        const finishOldRenewal = Promise.withResolvers<void>()
        const fakeFetch: typeof fetch = Object.assign(
            async (url: string | URL | Request, init?: RequestInit) => {
                const href = url instanceof Request ? url.url : String(url)
                if (href === 'https://auth.example.test/.well-known/oauth-authorization-server')
                    return Response.json({
                        issuer: 'https://auth.example.test',
                        client_id_metadata_document_supported: true,
                        authorization_endpoint: 'https://auth.example.test/authorize',
                        token_endpoint: 'https://auth.example.test/token',
                        pushed_authorization_request_endpoint: 'https://auth.example.test/par',
                        response_types_supported: ['code'],
                        grant_types_supported: ['authorization_code', 'refresh_token'],
                        code_challenge_methods_supported: ['S256'],
                        token_endpoint_auth_methods_supported: ['none'],
                        dpop_signing_alg_values_supported: ['ES256'],
                        scopes_supported: ['atproto'],
                    })
                if (href === `https://plc.directory/${encodeURIComponent(accountId)}`)
                    return Response.json({
                        id: accountId,
                        service: [
                            {
                                id: '#atproto_pds',
                                type: 'AtprotoPersonalDataServer',
                                serviceEndpoint: 'https://pds.example.test',
                            },
                        ],
                    })
                if (href === 'https://pds.example.test/.well-known/oauth-protected-resource')
                    return Response.json({
                        resource: 'https://pds.example.test',
                        authorization_servers: ['https://auth.example.test'],
                        scopes_supported: ['atproto'],
                        bearer_methods_supported: ['header'],
                    })
                if (href === 'https://auth.example.test/token') {
                    const body = new URLSearchParams(
                        url instanceof Request ? await url.clone().text() : String(init?.body)
                    )
                    expect(body.get('refresh_token')).toBe(`single-use-${renewals}`)
                    renewals++
                    if (renewals === 1) {
                        entered.resolve()
                        await release.promise
                    }
                    if (renewals === 3) {
                        reconnectDuringRenewal.resolve()
                        await finishOldRenewal.promise
                    }
                    return Response.json({
                        access_token: `fresh-${renewals}`,
                        refresh_token: `single-use-${renewals}`,
                        expires_in: 3600,
                        scope: 'atproto',
                        sub: accountId,
                        token_type: 'DPoP',
                    })
                }
                throw new Error(`Unexpected synthetic OAuth URL: ${href}`)
            },
            { preconnect: fetch.preconnect }
        )
        const prepare = () =>
            restoreCredentialBlueskySession({
                projectId: project.project.id,
                credentialId: created.credential.id,
                accountId,
                credentials,
                resolveOAuth: async () => ({
                    clientMetadata: createBlueskyLoopbackClientMetadata({
                        redirectUri: 'http://127.0.0.1:3000/api/oauth/bluesky/callback',
                    }),
                    handleResolver: 'https://resolver.example.test',
                    fetch: fakeFetch,
                }),
            })
        const first = prepare()
        await Promise.race([
            entered.promise,
            first.then(() => {
                throw new Error('The expired session did not renew')
            }),
        ])
        const second = prepare()
        release.resolve()
        const sessions = await Promise.all([first, second])
        expect(renewals).toBe(1)
        await Promise.all(sessions.map(session => session.session.getTokenInfo()))
        expect(renewals).toBe(1)
        expect(
            (
                await credentials.resolvePublisherCredentialSecrets(
                    project.project.id,
                    created.credential.id
                )
            )?.refreshToken
        ).toBe('single-use-1')
        const expiredLater = serializeBlueskySession({
            ...session,
            tokenSet: {
                ...session.tokenSet,
                access_token: 'fresh-1',
                refresh_token: 'single-use-1',
            },
        })
        expect(
            (
                await credentials.replacePublisherCredentialTokens({
                    projectId: project.project.id,
                    credentialId: created.credential.id,
                    accessToken: 'fresh-1',
                    refreshToken: 'single-use-1',
                    providerSession: expiredLater,
                    expiresAt: Date.now() - 60000,
                })
            ).kind
        ).toBe('updated')
        await Promise.all(sessions.map(session => session.session.getTokenInfo()))
        expect(renewals).toBe(2)
        const saved = await credentials.resolvePublisherCredentialSecrets(
            project.project.id,
            created.credential.id
        )
        expect(saved?.accessToken).toBe('fresh-2')
        expect(saved?.providerSession).toContain('single-use-2')
        await credentials.replacePublisherCredentialTokens({
            projectId: project.project.id,
            credentialId: created.credential.id,
            accessToken: 'fresh-2',
            refreshToken: 'single-use-2',
            providerSession: serializeBlueskySession({
                ...session,
                tokenSet: {
                    ...session.tokenSet,
                    access_token: 'fresh-2',
                    refresh_token: 'single-use-2',
                },
            }),
            expiresAt: Date.now() - 60000,
        })
        const staleRenewal = sessions[0]!.session.getTokenInfo()
        await Promise.race([
            reconnectDuringRenewal.promise,
            staleRenewal.then(() => {
                throw new Error('The stale session did not renew')
            }),
        ])
        const newGrant = serializeBlueskySession({
            ...session,
            dpopKey: await createBlueskyRuntimeImplementation().createKey(['ES256']),
            tokenSet: {
                ...session.tokenSet,
                access_token: 'new-owner-grant',
                refresh_token: 'new-owner-refresh',
                expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
        })
        expect(
            (
                await credentials.replacePublisherCredentialTokens({
                    projectId: project.project.id,
                    credentialId: created.credential.id,
                    accessToken: 'new-owner-grant',
                    refreshToken: 'new-owner-refresh',
                    providerSession: newGrant,
                    expiresAt: Date.now() + 3600000,
                })
            ).kind
        ).toBe('updated')
        finishOldRenewal.resolve()
        await expect(staleRenewal).rejects.toThrow()
        expect(
            credentials.getPublisherCredential(project.project.id, created.credential.id)?.state
        ).toBe('active')
        expect(
            (
                await credentials.resolvePublisherCredentialSecrets(
                    project.project.id,
                    created.credential.id
                )
            )?.accessToken
        ).toBe('new-owner-grant')
        await expect(sessions[1]!.session.getTokenInfo()).rejects.toThrow('credential changed')
        const freshGrantSession = await prepare()
        expect((await freshGrantSession.session.getTokenInfo()).sub).toBe(accountId)
        expect(renewals).toBe(3)
        expect(
            credentials.getPublisherCredential(project.project.id, created.credential.id)?.state
        ).toBe('active')
    } finally {
        closeDatabase(database)
    }
}, 10000)
