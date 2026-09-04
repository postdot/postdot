import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createAuthorizationAttemptStore } from './oauth-authorization-attempt-store'
import { createPublisherCredentialCipher } from './publisher-credential-crypto'
import { actors, oauthAuthorizationAttempts } from './schema'

const now = 1_800_000_000_000
const codeVerifier = 'a'.repeat(43)

async function stateDigest(value: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

function createFixture() {
    const database = createDatabase(':memory:')
    runMigrations(database)

    let timestamp = now
    let sequence = 0
    const manualStore = createManualStore(database, { now: () => timestamp })
    const project = manualStore.createProject({
        name: 'OAuth Project',
        subjectId: 'user-1',
        displayName: 'Herald Operator',
    })
    const channel = manualStore.createChannel({
        projectId: project.project.id,
        subjectId: 'user-1',
        name: 'LinkedIn',
    })
    if (channel === null) throw new Error('Expected test channel')

    const cipher = createPublisherCredentialCipher({
        keyId: 'primary',
        key: new Uint8Array(32).fill(1),
    })
    const store = createAuthorizationAttemptStore(database, {
        cipher,
        now: () => timestamp,
        createId: () => `attempt-${++sequence}`,
        ttlMs: 60_000,
        validateReturnPath(returnPath) {
            if (!returnPath.startsWith('/projects/')) throw new Error('returnPath is not allowed')
            return returnPath
        },
    })

    return {
        database,
        manualStore,
        project,
        channel,
        cipher,
        store,
        advance(milliseconds: number) {
            timestamp += milliseconds
        },
    }
}

async function createAttemptInput(fixture: ReturnType<typeof createFixture>, state: string) {
    return {
        projectId: fixture.project.project.id,
        channelId: fixture.channel.id,
        connectedByActorId: fixture.project.actor.id,
        providerId: 'linkedin',
        callbackUri: 'https://herald.example.com/api/oauth/linkedin/callback',
        scopes: ['w_member_social', 'openid'],
        returnPath: `/projects/${fixture.project.project.id}/channels/${fixture.channel.id}`,
        stateDigest: await stateDigest(state),
        codeVerifier,
    } as const
}

describe('OAuth authorization attempt store', () => {
    it('rejects authorization attempts for archived channels', async () => {
        const fixture = createFixture()

        try {
            const archived = fixture.manualStore.archiveChannel({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                subjectId: 'user-1',
                expectedRevision: 1,
            })
            expect(archived).toMatchObject({ kind: 'updated' })

            const result = await fixture.store.createAuthorizationAttempt(
                await createAttemptInput(fixture, 'archived-channel')
            )
            expect(result).toEqual({ kind: 'not_found' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('stores only a state digest and encrypted PKCE verifier', async () => {
        const fixture = createFixture()

        try {
            const input = await createAttemptInput(fixture, 'raw-state-value')
            const result = await fixture.store.createAuthorizationAttempt({
                ...input,
                context: { destination: { type: 'organization', id: '12345' } },
            })

            expect(result.kind).toBe('created')
            if (result.kind !== 'created') return
            expect(result.attempt).toMatchObject({
                projectId: fixture.project.project.id,
                channelId: fixture.channel.id,
                connectedByActorId: fixture.project.actor.id,
                providerId: 'linkedin',
                scopes: ['openid', 'w_member_social'],
                context: { destination: { type: 'organization', id: '12345' } },
                expiresAt: now + 60_000,
            })
            expect(result.attempt).not.toHaveProperty('state')
            expect(result.attempt).not.toHaveProperty('codeVerifier')

            const stored = fixture.database.select().from(oauthAuthorizationAttempts).get()
            expect(stored?.stateDigest).toEqual(Buffer.from(input.stateDigest))
            expect(stored?.stateDigest).not.toEqual(Buffer.from('raw-state-value'))
            expect(
                new TextDecoder().decode(stored?.pkceVerifierCiphertext ?? undefined)
            ).not.toContain(codeVerifier)
            expect(stored?.pkceVerifierNonce).toHaveLength(12)
            expect(JSON.stringify(stored)).not.toContain('raw-state-value')
            expect(JSON.stringify(stored)).not.toContain(codeVerifier)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('supports providers whose authorization flow does not use PKCE', async () => {
        const fixture = createFixture()

        try {
            const input = await createAttemptInput(fixture, 'non-pkce-state')
            const result = await fixture.store.createAuthorizationAttempt({
                ...input,
                codeVerifier: null,
            })

            expect(result.kind).toBe('created')
            const stored = fixture.database.select().from(oauthAuthorizationAttempts).get()
            expect(stored).toMatchObject({
                pkceEncryptionVersion: null,
                pkceEncryptionKeyId: null,
                pkceVerifierCiphertext: null,
                pkceVerifierNonce: null,
            })

            const consumed = await fixture.store.consumeAuthorizationAttempt({
                stateDigest: input.stateDigest,
                connectedByActorId: input.connectedByActorId,
                providerId: input.providerId,
                callbackUri: input.callbackUri,
            })
            expect(consumed).toMatchObject({ kind: 'consumed', codeVerifier: null })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('consumes once, returns the verifier internally, and erases its envelope', async () => {
        const fixture = createFixture()

        try {
            const input = await createAttemptInput(fixture, 'state-once')
            const created = await fixture.store.createAuthorizationAttempt(input)
            expect(created.kind).toBe('created')

            const consumed = await fixture.store.consumeAuthorizationAttempt({
                stateDigest: input.stateDigest,
                connectedByActorId: input.connectedByActorId,
                providerId: input.providerId,
                callbackUri: input.callbackUri,
            })
            expect(consumed.kind).toBe('consumed')
            if (consumed.kind !== 'consumed') return
            expect(consumed.codeVerifier).toBe(codeVerifier)
            expect(consumed.attempt.returnPath).toBe(input.returnPath)

            expect(fixture.database.select().from(oauthAuthorizationAttempts).get()).toMatchObject({
                status: 'consumed',
                completedAt: now,
                pkceEncryptionVersion: null,
                pkceEncryptionKeyId: null,
                pkceVerifierCiphertext: null,
                pkceVerifierNonce: null,
            })
            expect(
                await fixture.store.consumeAuthorizationAttempt({
                    stateDigest: input.stateDigest,
                    connectedByActorId: input.connectedByActorId,
                    providerId: input.providerId,
                    callbackUri: input.callbackUri,
                })
            ).toEqual({ kind: 'already_used' })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects binding mismatches without invalidating the legitimate callback', async () => {
        const fixture = createFixture()

        try {
            fixture.database
                .insert(actors)
                .values({
                    id: 'other-actor',
                    projectId: fixture.project.project.id,
                    kind: 'human',
                    subjectId: 'user-2',
                    displayName: 'Other Operator',
                })
                .run()
            const input = await createAttemptInput(fixture, 'bound-state')
            await fixture.store.createAuthorizationAttempt(input)

            for (const mismatch of [
                { connectedByActorId: 'other-actor' },
                { providerId: 'mastodon' },
                { callbackUri: 'https://herald.example.com/api/oauth/other/callback' },
            ]) {
                expect(
                    await fixture.store.consumeAuthorizationAttempt({
                        stateDigest: input.stateDigest,
                        connectedByActorId: input.connectedByActorId,
                        providerId: input.providerId,
                        callbackUri: input.callbackUri,
                        ...mismatch,
                    })
                ).toEqual({ kind: 'mismatch' })
            }

            expect(
                (
                    await fixture.store.consumeAuthorizationAttempt({
                        stateDigest: input.stateDigest,
                        connectedByActorId: input.connectedByActorId,
                        providerId: input.providerId,
                        callbackUri: input.callbackUri,
                    })
                ).kind
            ).toBe('consumed')
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('expires pending attempts and erases verifiers before rejecting callbacks', async () => {
        const fixture = createFixture()

        try {
            const first = await createAttemptInput(fixture, 'expired-on-callback')
            await fixture.store.createAuthorizationAttempt(first)
            fixture.advance(60_000)

            expect(
                await fixture.store.consumeAuthorizationAttempt({
                    stateDigest: first.stateDigest,
                    connectedByActorId: first.connectedByActorId,
                    providerId: first.providerId,
                    callbackUri: first.callbackUri,
                })
            ).toEqual({ kind: 'expired' })
            expect(fixture.database.select().from(oauthAuthorizationAttempts).get()).toMatchObject({
                status: 'expired',
                pkceVerifierCiphertext: null,
                pkceVerifierNonce: null,
            })

            const second = await createAttemptInput(fixture, 'expired-by-cleanup')
            await fixture.store.createAuthorizationAttempt(second)
            fixture.advance(60_000)
            expect(fixture.store.expireAuthorizationAttempts()).toBe(1)
            expect(fixture.store.expireAuthorizationAttempts()).toBe(0)
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('serializes replay races and state-digest collisions', async () => {
        const fixture = createFixture()

        try {
            const input = await createAttemptInput(fixture, 'race-state')
            expect((await fixture.store.createAuthorizationAttempt(input)).kind).toBe('created')
            expect((await fixture.store.createAuthorizationAttempt(input)).kind).toBe(
                'state_collision'
            )

            const callback = {
                stateDigest: input.stateDigest,
                connectedByActorId: input.connectedByActorId,
                providerId: input.providerId,
                callbackUri: input.callbackUri,
            }
            const results = await Promise.all([
                fixture.store.consumeAuthorizationAttempt(callback),
                fixture.store.consumeAuthorizationAttempt(callback),
            ])
            expect(results.map(result => result.kind).sort()).toEqual(['already_used', 'consumed'])
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('fails closed after consumption when the deployment key is wrong', async () => {
        const fixture = createFixture()

        try {
            const input = await createAttemptInput(fixture, 'wrong-key-state')
            await fixture.store.createAuthorizationAttempt(input)
            const wrongKeyStore = createAuthorizationAttemptStore(fixture.database, {
                cipher: createPublisherCredentialCipher({
                    keyId: 'primary',
                    key: new Uint8Array(32).fill(2),
                }),
                now: () => now,
                validateReturnPath: value => value,
            })

            await expect(
                wrongKeyStore.consumeAuthorizationAttempt({
                    stateDigest: input.stateDigest,
                    connectedByActorId: input.connectedByActorId,
                    providerId: input.providerId,
                    callbackUri: input.callbackUri,
                })
            ).rejects.toMatchObject({ code: 'decryption_failed' })
            expect(fixture.database.select().from(oauthAuthorizationAttempts).get()).toMatchObject({
                status: 'consumed',
                pkceVerifierCiphertext: null,
            })
        } finally {
            closeDatabase(fixture.database)
        }
    })

    it('rejects invalid bindings, return paths, state digests, and verifiers', async () => {
        const fixture = createFixture()

        try {
            const valid = await createAttemptInput(fixture, 'validation-state')
            await expect(
                fixture.store.createAuthorizationAttempt({
                    ...valid,
                    returnPath: '/admin',
                })
            ).rejects.toThrow('returnPath is not allowed')
            await expect(
                fixture.store.createAuthorizationAttempt({
                    ...valid,
                    stateDigest: new Uint8Array(31),
                })
            ).rejects.toThrow('exactly 32 bytes')
            await expect(
                fixture.store.createAuthorizationAttempt({
                    ...valid,
                    codeVerifier: 'too-short',
                })
            ).rejects.toThrow('RFC 7636')
            expect(
                (
                    await fixture.store.createAuthorizationAttempt({
                        ...valid,
                        channelId: 'missing-channel',
                    })
                ).kind
            ).toBe('not_found')
        } finally {
            closeDatabase(fixture.database)
        }
    })
})
