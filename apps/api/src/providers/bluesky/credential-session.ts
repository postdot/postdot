import { readBlueskySessionTokenSet, restoreBlueskySession } from '@postdot/bluesky'
import type { PublisherCredentialRefreshContext } from '@postdot/db'

import type { PublisherCredentialExecutionPort } from '../../modules/workflow/providers/registry'

function sessionKeyIdentity(serialized: string | null): string | null {
    if (serialized === null) return null
    try {
        const value = JSON.parse(serialized) as {
            dpopJwk?: Record<string, unknown>
        }
        const key = value.dpopJwk
        // Public key coordinates distinguish a new OAuth grant; token rotation
        // keeps the proof key. Never make an old SDK session adopt a new key.
        return JSON.stringify([key?.kty, key?.crv, key?.x, key?.y, key?.n, key?.e])
    } catch {
        return null
    }
}

/** SDK request locks cover restoration AND implicit renewal during later requests. */
export async function restoreCredentialBlueskySession(input: {
    readonly projectId: string
    readonly credentialId: string
    readonly accountId: string
    readonly credentials: Pick<
        PublisherCredentialExecutionPort,
        'withPublisherCredentialRefresh' | 'resolvePublisherCredentialSecrets'
    >
    readonly resolveOAuth: (
        applicationId: string | null
    ) => Promise<Parameters<typeof restoreBlueskySession>[0]['client'] | undefined>
    readonly restoreSession?: typeof restoreBlueskySession
    readonly signal?: AbortSignal
}) {
    const initial = await input.credentials.withPublisherCredentialRefresh(
        input.projectId,
        input.credentialId,
        async context => {
            if (!context?.secrets.providerSession)
                throw new Error('The Bluesky credential is unavailable')
            return {
                credential: context.credential,
                serialized: context.secrets.providerSession,
                markReconnectRequired: context.markReconnectRequired,
            }
        },
        input.signal
    )
    const oauth = await input.resolveOAuth(initial.credential.providerApplicationId ?? null)
    if (!oauth) throw new Error('The Bluesky publisher is not configured')
    let active: PublisherCredentialRefreshContext | null = null
    try {
        return await (input.restoreSession ?? restoreBlueskySession)({
            sub: input.accountId,
            serializedSession: initial.serialized,
            client: oauth,
            requestLock: async (_name, operation) =>
                input.credentials.withPublisherCredentialRefresh(
                    input.projectId,
                    input.credentialId,
                    async context => {
                        if (
                            !context ||
                            context.credential.externalAccountId !== input.accountId ||
                            sessionKeyIdentity(context.secrets.providerSession) !==
                                sessionKeyIdentity(initial.serialized) ||
                            (context.credential.providerApplicationId ?? null) !==
                                (initial.credential.providerApplicationId ?? null)
                        )
                            throw new Error(
                                'The Bluesky credential changed during session preparation'
                            )
                        active = context
                        try {
                            return await operation()
                        } finally {
                            active = null
                        }
                    },
                    input.signal
                ),
            sessionStore: {
                async get(key) {
                    if (key !== input.accountId) return undefined
                    const current = await input.credentials.resolvePublisherCredentialSecrets(
                        input.projectId,
                        input.credentialId
                    )
                    return current?.providerSession ?? undefined
                },
                async set(key, serialized) {
                    if (!active || key !== input.accountId)
                        throw new Error('Bluesky session persistence requires credential ownership')
                    const tokens = readBlueskySessionTokenSet(serialized)
                    if (!tokens || tokens.sub !== input.accountId)
                        throw new Error('The Bluesky session identity is invalid')
                    const expiry = tokens.expiresAt === null ? NaN : Date.parse(tokens.expiresAt)
                    const result = await active.replaceTokens({
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken ?? undefined,
                        providerSession: serialized,
                        expiresAt: Number.isSafeInteger(expiry) && expiry >= 0 ? expiry : null,
                    })
                    if (result.kind !== 'updated')
                        throw new Error('The Bluesky session changed before persistence')
                },
                async del(key) {
                    if (key === input.accountId)
                        (active?.markReconnectRequired ?? initial.markReconnectRequired)()
                },
            },
        })
    } catch (error) {
        if (!input.signal?.aborted) initial.markReconnectRequired()
        throw error
    }
}
