import {
    readThreadContinuations,
    threadValidationIssues,
    type ExternalEffectOutcome,
} from '@postdot/core'
import type { PublisherExecutionTarget, ThreadReceipt } from '@postdot/db'

import { ambiguousFailure, permanentFailure } from '../outcomes'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

export interface ThreadMessageContext {
    readonly position: number
    readonly root: ThreadReceipt
    readonly parent: ThreadReceipt
}

export interface ThreadExecutionPolicy {
    readonly validateContent?: (content: Readonly<Record<string, unknown>>) => string | null
    readonly validateReceipt?: (receipt: ThreadReceipt, target: PublisherExecutionTarget) => boolean
    readonly continuationContent?: (
        content: Readonly<Record<string, unknown>>
    ) => Readonly<Record<string, unknown>>
}

/** Confirmed messages are immutable; only a known rejected next message may be retried. */
export function withThreadExecution(
    adapter: BuiltInProviderAdapter,
    revision: string,
    validText: (text: string) => boolean,
    policy: ThreadExecutionPolicy = {}
): BuiltInProviderAdapter {
    return {
        ...adapter,
        revision,
        execute: input => executeThread(adapter, input, validText, policy),
    }
}

async function executeThread(
    adapter: BuiltInProviderAdapter,
    input: BuiltInProviderExecutionInput,
    validText: (text: string) => boolean,
    policy: ThreadExecutionPolicy
): Promise<ExternalEffectOutcome> {
    const thread = readThreadContinuations(input.target.content)
    if (thread === null || threadValidationIssues(input.target.content, validText).length)
        return permanentFailure('The thread contains invalid messages')
    if (!thread.length) return adapter.execute(input)
    const contentError = policy.validateContent?.(input.target.content)
    if (contentError) return permanentFailure(contentError)
    const store = input.threadStore
    if (!store) return permanentFailure('Thread publication persistence is unavailable')
    if (
        await store.hasPriorEffects(
            input.target.projectId,
            input.target.publicationId,
            input.target.executionRevisionId
        )
    )
        return ambiguousFailure(
            'An earlier thread execution requires review before publishing again'
        )
    let root: ThreadReceipt | undefined
    let parent: ThreadReceipt | undefined
    const texts = [input.target.content.text, ...thread.map(message => message.text)]
    if (typeof texts[0] !== 'string' || !texts[0].trim() || !validText(texts[0]))
        return permanentFailure('The first thread message is invalid')
    for (let position = 0; position < texts.length; position++) {
        const identity = {
            projectId: input.target.projectId,
            executionRevisionId: input.target.executionRevisionId,
            position,
        }
        await input.assertActive?.()
        const saved = await store.reserve(identity)
        if (saved.state === 'confirmed' && saved.externalId) {
            parent = {
                externalId: saved.externalId,
                ...(saved.externalUrl ? { externalUrl: saved.externalUrl } : {}),
                ...(saved.externalCid ? { externalCid: saved.externalCid } : {}),
            }
            if (policy.validateReceipt && !policy.validateReceipt(parent, input.target))
                return ambiguousFailure(
                    'The saved thread receipt requires review before continuing'
                )
            root ??= parent
            continue
        }
        const interrupted = (message: string) =>
            `Thread interrupted after ${position} of ${texts.length} confirmed messages. ${message}`
        if (saved.state === 'sending' || saved.state === 'ambiguous')
            return ambiguousFailure(
                interrupted(
                    saved.errorMessage ??
                        'The next message has an unknown remote outcome; review it before continuing'
                )
            )
        if (!(await store.start(identity)))
            return ambiguousFailure(interrupted('The message could not be started'))
        let outcome: ExternalEffectOutcome
        try {
            const content: Record<string, unknown> = { ...input.target.content }
            delete content.thread
            const messageContent =
                position === 0
                    ? content
                    : (policy.continuationContent?.(content) ?? { text: content.text, media: [] })
            outcome = await adapter.execute({
                ...input,
                threadMessage: root && parent ? { position, root, parent } : undefined,
                target: {
                    ...input.target,
                    content: { ...messageContent, text: texts[position] },
                    media: position === 0 ? input.target.media : [],
                    mediaReferenceCount: position === 0 ? input.target.mediaReferenceCount : 0,
                },
            })
        } catch {
            outcome = ambiguousFailure('The next message has an unknown remote outcome')
        }
        if (outcome.type !== 'published') {
            const errorMessage = interrupted(outcome.errorMessage)
            if (
                !(await store.settle({
                    ...identity,
                    state: outcome.type === 'ambiguous' ? 'ambiguous' : 'failed',
                    errorMessage,
                }))
            )
                return ambiguousFailure(interrupted('The message outcome could not be persisted'))
            if (position > 0 && outcome.type !== 'ambiguous')
                return {
                    type: 'checkpointed_failure',
                    effectOccurred: true,
                    retryable: outcome.type === 'retryable_failure' || outcome.type === 'deferred',
                    confirmedMessageCount: position,
                    errorMessage,
                }
            return { ...outcome, errorMessage }
        }
        const receipt = outcome as ThreadReceipt
        if (
            !receipt.externalId ||
            (policy.validateReceipt && !policy.validateReceipt(receipt, input.target))
        )
            return ambiguousFailure(
                interrupted('The provider returned an incomplete thread receipt')
            )
        if (!(await store.settle({ ...identity, state: 'confirmed', receipt })))
            return ambiguousFailure(
                interrupted('The published message receipt could not be persisted')
            )
        parent = receipt
        root ??= receipt
    }
    return { type: 'published', ...root! }
}
