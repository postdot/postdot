import type { ChannelProfileDefinition } from './channel-profile'
import { DomainInvariantError } from './invariants'
import type { ValidationIssue } from './validation'

/** Postdot's authoring envelope, not a remote platform limit. */
export const MAX_THREAD_MESSAGES = 25

export interface ThreadContinuation {
    readonly text: string
}

/** Destination-native continuations leave the reusable source unchanged. */
export function withThreadAuthoring(
    profile: ChannelProfileDefinition,
    revision: string,
    maxLength: number
): ChannelProfileDefinition {
    if (profile.execution.kind !== 'built_in')
        throw new DomainInvariantError(
            'invalid_content',
            'Thread authoring requires a native execution contract'
        )
    const schema = profile.contentSchema as Record<string, unknown> & {
        properties: Record<string, unknown>
    }
    return {
        ...profile,
        version: profile.version + 1,
        profileHash: `${profile.profileHash}-thread`,
        schemaHash: `${profile.schemaHash}-thread`,
        contentSchema: {
            ...schema,
            properties: {
                ...schema.properties,
                thread: {
                    type: 'array',
                    maxItems: MAX_THREAD_MESSAGES - 1,
                    items: {
                        type: 'object',
                        properties: { text: { type: 'string', minLength: 1, maxLength } },
                        required: ['text'],
                        additionalProperties: false,
                    },
                },
            },
        },
        capabilities: {
            ...profile.capabilities,
            revision: `${profile.capabilities.revision}-thread`,
        },
        execution: { ...profile.execution, revision },
    }
}

export function readThreadContinuations(
    content: Readonly<Record<string, unknown>>
): readonly ThreadContinuation[] | null {
    if (content.thread === undefined) return []
    if (!Array.isArray(content.thread) || content.thread.length >= MAX_THREAD_MESSAGES) return null
    const result: ThreadContinuation[] = []
    for (const item of content.thread) {
        if (
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            Object.keys(item).some(key => key !== 'text') ||
            typeof item.text !== 'string' ||
            !item.text.trim()
        )
            return null
        result.push({ text: item.text })
    }
    return result
}

export function threadValidationIssues(
    content: Readonly<Record<string, unknown>>,
    validText: (text: string) => boolean
): ValidationIssue[] {
    const thread = readThreadContinuations(content)
    const issue = (path: string): ValidationIssue => ({
        path,
        code: 'content.thread_invalid',
        message: 'Each thread message must contain text within the destination limits',
        severity: 'error',
        source: 'capability',
    })
    if (thread === null) return [issue('/thread')]
    return thread.flatMap((message, index) =>
        validText(message.text) ? [] : [issue(`/thread/${index}/text`)]
    )
}
