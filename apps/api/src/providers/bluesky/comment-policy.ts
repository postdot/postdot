import { DomainInvariantError, requireNonBlank, type ProviderCommentPolicy } from '@postdot/core'
export const blueskyCommentPolicy = {
    id: 'bluesky',
    textLimit: 300,
    maxTextLength: 3000,
    requiresInstanceOrigin: false,
    normalizeText(value) {
        const text = requireNonBlank(value, 'first comment text')
        if (text.length > 3000)
            throw new DomainInvariantError(
                'invalid_input',
                'first comment text must not exceed 3000 UTF-16 code units'
            )
        if (
            [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length >
            300
        )
            throw new DomainInvariantError(
                'invalid_input',
                'first comment text must not exceed 300 graphemes'
            )
        return text
    },
    resolveParent({ receiptExternalId }) {
        if (!receiptExternalId?.startsWith('at://')) return null
        const remainder = receiptExternalId.slice('at://'.length)
        const separator = remainder.indexOf('/')
        return separator <= 0
            ? null
            : {
                  rootUri: receiptExternalId,
                  instanceOrigin: null,
                  accountId: remainder.slice(0, separator),
              }
    },
    identityFailure: (parent, identity) =>
        parent.accountId === identity.accountId ? null : 'account',
    publicationId: rootUri => rootUri,
} as const satisfies ProviderCommentPolicy<'bluesky'>
