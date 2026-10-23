import { DomainInvariantError, requireNonBlank, type ProviderCommentPolicy } from '@postdot/core'
import { resolveMastodonStatusReference } from '@postdot/mastodon'

export function createMastodonCommentPolicy(
    resolver: typeof resolveMastodonStatusReference | null = resolveMastodonStatusReference
) {
    return {
        id: 'mastodon',
        textLimit: 500,
        maxTextLength: 500,
        requiresInstanceOrigin: true,
        normalizeText(value) {
            const text = requireNonBlank(value, 'first comment text')
            if (text.length > 500)
                throw new DomainInvariantError(
                    'invalid_input',
                    'first comment text must not exceed 500 UTF-16 code units'
                )
            return text
        },
        resolveParent({ externalId, externalUrl }) {
            if (!resolver) return null
            try {
                const reference = resolver(externalId, externalUrl)
                return reference
                    ? {
                          rootUri: reference.rootUri,
                          instanceOrigin: reference.origin,
                          accountId: null,
                      }
                    : null
            } catch {
                return null
            }
        },
        identityFailure(parent, identity) {
            if (identity.endpointUrl !== parent.instanceOrigin) return 'connection'
            let scopes: unknown
            try {
                scopes = JSON.parse(identity.scopes)
            } catch {
                return 'authorization'
            }
            return Array.isArray(scopes) &&
                scopes.some(scope => scope === 'write' || scope === 'write:statuses')
                ? null
                : 'authorization'
        },
        publicationId: rootUri => rootUri.split('/').at(-1) ?? null,
    } as const satisfies ProviderCommentPolicy<'mastodon'>
}
export const mastodonCommentPolicy = createMastodonCommentPolicy()
