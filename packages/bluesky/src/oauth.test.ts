import { describe, expect, it } from 'bun:test'

import type { Session } from '@atproto/oauth-client'

import { BLUESKY_REQUIRED_SCOPES } from './contract'
import {
    createBlueskyOAuthClient,
    createBlueskyLoopbackClientMetadata,
    createBlueskySessionStore,
    createBlueskyRuntimeImplementation,
    createBlueskyStateStore,
    createBlueskyStateStoreWithKeyCapture,
    serializeBlueskySession,
} from './oauth'

function memoryStore() {
    const values = new Map<string, string>()
    return {
        values,
        async get(key: string) {
            return values.get(key)
        },
        async set(key: string, value: string) {
            values.set(key, value)
        },
        async del(key: string) {
            values.delete(key)
        },
    }
}

describe('Bluesky OAuth runtime', () => {
    it('constructs the official AT Protocol loopback client metadata', () => {
        const metadata = createBlueskyLoopbackClientMetadata({
            redirectUri: 'http://127.0.0.1:3000/api/oauth/bluesky/callback',
        })

        expect(metadata).toMatchObject({
            client_id:
                'http://localhost?scope=atproto+repo%3Aapp.bsky.feed.post%3Faction%3Dcreate+blob%3Aimage%2F*&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Foauth%2Fbluesky%2Fcallback',
            redirect_uris: ['http://127.0.0.1:3000/api/oauth/bluesky/callback'],
            scope: BLUESKY_REQUIRED_SCOPES.join(' '),
            application_type: 'native',
            token_endpoint_auth_method: 'none',
            dpop_bound_access_tokens: true,
        })
    })

    it('maps OAuth digest names to Bun Web Crypto names', async () => {
        const digest = await createBlueskyRuntimeImplementation().digest(
            new TextEncoder().encode('herald'),
            { name: 'sha256' }
        )

        expect(Buffer.from(digest).toString('hex')).toBe(
            '1c85bf7d3c260817db543a95c0e52d02563b5dd4dbd8bd656de82c8a0c0610b2'
        )
    })

    it('constructs the official portable client under Bun', () => {
        const client = createBlueskyOAuthClient({
            clientMetadata: {
                client_id: 'https://herald.example.com/oauth/client-metadata.json',
                client_name: 'Herald',
                client_uri: 'https://herald.example.com',
                redirect_uris: ['https://herald.example.com/api/oauth/bluesky/callback'],
                scope: 'atproto',
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
                application_type: 'web',
                dpop_bound_access_tokens: true,
            },
            handleResolver: 'https://bsky.social',
            stateStore: createBlueskyStateStore(memoryStore()),
            sessionStore: createBlueskySessionStore(memoryStore()),
        })

        expect(client.clientMetadata.client_id).toBe(
            'https://herald.example.com/oauth/client-metadata.json'
        )
        expect(client.responseMode).toBe('query')
    })

    it('captures the internal state key used by pushed authorization requests', async () => {
        const serialized = memoryStore()
        const { getCapturedKey, stateStore } = createBlueskyStateStoreWithKeyCapture(serialized)
        const key = await (
            await import('@atproto/jwk-webcrypto')
        ).WebcryptoKey.generate(['ES256'], undefined, { extractable: true })

        await stateStore.set('oauth-state', {
            iss: 'https://bsky.social',
            dpopKey: key,
            authMethod: { method: 'none' },
            verifier: 'verifier',
        })

        expect(getCapturedKey()).toBe('oauth-state')
        expect(await stateStore.get('oauth-state')).toBeDefined()
    })

    it('serializes an extractable DPoP session without exposing it in the public shape', async () => {
        const serialized = memoryStore()
        const store = createBlueskySessionStore(serialized)
        const key = await (
            await import('@atproto/jwk-webcrypto')
        ).WebcryptoKey.generate(['ES256'], undefined, { extractable: true })
        const session: Session = {
            dpopKey: key,
            authMethod: { method: 'none' as const },
            tokenSet: {
                iss: 'https://bsky.social',
                sub: 'did:plc:test',
                aud: 'https://pds.example.com',
                scope: 'atproto' as const,
                access_token: 'access-token',
                refresh_token: 'refresh-token',
                token_type: 'DPoP' as const,
                expires_at: new Date(1_800_000_000_000).toISOString(),
            },
        }

        await store.set(session.tokenSet.sub, session)
        const raw = serialized.values.get(session.tokenSet.sub) ?? ''
        expect(raw).toContain('dpopJwk')
        expect(raw).toContain('access-token')
        expect(raw).not.toContain('dpopKey')

        const restored = await store.get(session.tokenSet.sub)
        expect(restored?.dpopKey.isPrivate).toBe(true)
        expect(restored?.tokenSet).toEqual(session.tokenSet)
        expect(serializeBlueskySession(session)).toBe(raw)
    })
})
