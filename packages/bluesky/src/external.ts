import { threadValidationIssues } from '@postdot/core'
import type { ChannelProfileValidationAdapter } from '@postdot/core'

import type { BlueskyPostContent } from './contract'

export const BLUESKY_MAX_THUMBNAIL_BYTES = 1_000_000

/** Application bounds for metadata whose Lexicon fields have no numeric maximum. */
export function readBlueskyExternal(value: unknown): BlueskyPostContent['external'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const card = value as Record<string, unknown>
    if (
        typeof card.uri !== 'string' ||
        card.uri.length > 2048 ||
        typeof card.title !== 'string' ||
        !card.title.trim() ||
        card.title.length > 3000 ||
        typeof card.description !== 'string' ||
        card.description.length > 10000
    )
        return null
    try {
        const url = new URL(card.uri)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    } catch {
        return null
    }
    return { uri: card.uri, title: card.title, description: card.description }
}

export const blueskyChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'bluesky',
    validate(profile, content) {
        const threads =
            profile.execution.kind === 'built_in' && profile.execution.revision === 'post-v4'
                ? threadValidationIssues(
                      content,
                      text =>
                          text.length <= 3000 &&
                          [
                              ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
                                  text
                              ),
                          ].length <= 300
                  )
                : []
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== 'bluesky' ||
            !['post-v3', 'post-v4'].includes(profile.execution.revision) ||
            content.external === undefined
        )
            return threads
        const issue = (path: string, message: string) => [
            ...threads,
            {
                path,
                severity: 'error' as const,
                source: 'capability' as const,
                code: 'bluesky.external_invalid',
                message,
            },
        ]
        if (!readBlueskyExternal(content.external))
            return issue(
                '/external',
                'Enter a public HTTP or HTTPS link, a title and a description without embedded credentials'
            )
        if (Array.isArray(content.media) && content.media.length > 1)
            return issue('/media', 'A link card accepts at most one thumbnail image')
        return threads
    },
}
