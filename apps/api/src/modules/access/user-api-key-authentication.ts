import { postdotUserApiKeyConfigId, type PostdotAuth } from '@postdot/auth'

import { readUserApiKeyMetadata } from './api-key-routes'

/** Keys issued before the Postdot rename keep their original prefix; new keys use the first one. */
export const userApiKeyPrefixes = ['postdot_pat_', 'postbot_pat_'] as const

export interface AuthenticatedUserApiKey {
    /** null means all projects currently available to the key owner. */
    readonly projectIds: readonly string[] | null
    readonly ownerUserId: string
    readonly displayName: string
    readonly permissions: Awaited<
        ReturnType<PostdotAuth['api']['verifyApiKey']>
    >['key'] extends infer Key
        ? Key extends { permissions: infer Permissions }
            ? Permissions
            : never
        : never
}

/** Verifies a bearer token as a user-owned Postdot API key; any failure is indistinguishable. */
export function createUserApiKeyAuthenticator(auth: PostdotAuth) {
    return async (token: string): Promise<AuthenticatedUserApiKey | null> => {
        if (!userApiKeyPrefixes.some(prefix => token.startsWith(prefix))) return null

        try {
            const verified = await auth.api.verifyApiKey({
                body: { configId: postdotUserApiKeyConfigId, key: token },
            })
            if (!verified.valid || verified.key === null) return null
            const metadata = readUserApiKeyMetadata(verified.key.metadata)
            if (metadata === null) return null

            return {
                projectIds:
                    metadata.postdotProjectAccess === 'all'
                        ? null
                        : (metadata.postdotProjectIds ?? []),
                ownerUserId: verified.key.referenceId,
                displayName: `API key: ${verified.key.name ?? verified.key.id}`,
                permissions: verified.key.permissions,
            }
        } catch {
            return null
        }
    }
}
