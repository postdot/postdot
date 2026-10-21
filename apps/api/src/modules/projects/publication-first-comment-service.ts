import {
    blueskyReplyTextValid,
    createBlueskyReplyRecordKey,
    type BlueskyFetcher,
    type restoreBlueskySession,
} from '@postbot/bluesky'
import { processNextExternalEffect, type ExternalEffectOutcome } from '@postbot/core'
import {
    createAccessStore,
    createManualStore,
    createPublicationFirstCommentStore,
    type PostbotDatabase,
    type PublicationFirstComment,
} from '@postbot/db'
import { mastodonReplyTextValid, resolveMastodonStatusReference } from '@postbot/mastodon'

import type { PublisherRuntime } from '../publishers/runtime'
import { performMastodonFirstComment } from './publication-first-comment-mastodon'
import type {
    PublicationFirstCommentResponse,
    PublicationFirstCommentSave,
} from './publication-first-comment-models'
import { performBlueskyReply } from './publication-replies-bluesky'

const editableStates = new Set(['waiting', 'pending', 'suspended'])
const failed = (errorMessage: string): ExternalEffectOutcome => ({
    type: 'permanent_failure',
    effectOccurred: false,
    errorMessage,
})

export function createPublicationFirstCommentService(options: {
    readonly database: PostbotDatabase
    readonly publisher: PublisherRuntime
    readonly now?: () => number
    readonly restoreSession?: typeof restoreBlueskySession
    readonly contextFetcher?: BlueskyFetcher
    readonly performComment?: (
        work: PublicationFirstComment,
        signal: AbortSignal
    ) => Promise<ExternalEffectOutcome>
}) {
    const store = createPublicationFirstCommentStore(options.database, {
        mastodonStatusReference: resolveMastodonStatusReference,
    })
    const access = createAccessStore(options.database)
    const manual = createManualStore(options.database)
    const now = options.now ?? Date.now
    function get(
        projectId: string,
        publicationId: string,
        subjectId: string
    ): PublicationFirstCommentResponse | null {
        const editor = manual.getPublicationEditorState(projectId, publicationId, subjectId)
        if (!editor) return null
        const row = store.get(projectId, publicationId, subjectId)
        const execution = editor.profile.profile.execution
        const nativeProvider =
            execution.kind === 'built_in' &&
            (execution.contractId === 'bluesky' || execution.contractId === 'mastodon')
                ? execution.contractId
                : null
        const providerId = row?.providerId ?? nativeProvider
        const supported =
            nativeProvider !== null &&
            nativeProvider === providerId &&
            editor.publication.deliveryMode === 'automatic'
        if ((!supported && row === null) || !providerId) return null
        const canManage = access.canAccessProject(projectId, subjectId, 'editor')
        const canConfigure =
            canManage &&
            supported &&
            (row === null
                ? ['draft', 'scheduled'].includes(editor.publication.state)
                : editableStates.has(row.state))
        const author =
            row === null
                ? null
                : options.database.$client
                      .query<{ name: string }, [string, string]>(
                          'select display_name as name from actors where project_id = ?1 and id = ?2'
                      )
                      .get(projectId, row.actorId)
        return {
            providerId,
            textLimit: providerId === 'mastodon' ? 500 : 300,
            instanceOrigin: row?.instanceOrigin ?? null,
            firstComment:
                row === null
                    ? null
                    : {
                          id: row.id,
                          text: row.text,
                          delaySeconds: row.delaySeconds,
                          state: row.state,
                          revision: row.revision,
                          dueAt: row.dueAt,
                          createdAt: row.createdAt,
                          updatedAt: row.updatedAt,
                          externalUrl: row.externalUrl,
                          lastError: row.lastError,
                          authorName: author?.name ?? '',
                      },
            canManage,
            canConfigure,
        }
    }
    async function perform(
        work: PublicationFirstComment,
        signal: AbortSignal
    ): Promise<ExternalEffectOutcome> {
        let dispatched = false
        try {
            if (
                !work.rootUri ||
                !work.accountId ||
                !work.credentialId ||
                !store.claimCurrent(work, now())
            )
                return failed('The first comment is no longer eligible for dispatch')
            if (options.performComment) {
                dispatched = true
                return await options.performComment(work, signal)
            }
            if (work.providerId === 'mastodon') {
                return await performMastodonFirstComment({
                    work: {
                        ...work,
                        rootUri: work.rootUri,
                        credentialId: work.credentialId,
                        accountId: work.accountId,
                    },
                    publisher: options.publisher,
                    signal,
                    now: now(),
                    stillEligible: () => store.claimCurrent(work, now()),
                    onDispatch: () => {
                        dispatched = true
                    },
                })
            }
            return await performBlueskyReply({
                publisher: options.publisher,
                restoreSession: options.restoreSession,
                contextFetcher: options.contextFetcher,
                work: {
                    projectId: work.projectId,
                    rootUri: work.rootUri,
                    parentUri: work.rootUri,
                    accountId: work.accountId,
                    credentialId: work.credentialId,
                    text: work.text,
                    recordKey: work.recordKey,
                    createdAt: now(),
                },
                signal,
                stillEligible: () => store.claimCurrent(work, now()),
                onDispatch: () => {
                    dispatched = true
                },
            })
        } catch {
            return dispatched
                ? {
                      type: 'ambiguous',
                      errorMessage: 'The first-comment outcome could not be confirmed',
                  }
                : failed('The original account or parent could not be prepared')
        }
    }
    return {
        store,
        get,
        getNextEventAt: () => store.getNextEventAt(now()),
        save(
            input: PublicationFirstCommentSave & {
                projectId: string
                publicationId: string
                subjectId: string
            }
        ) {
            const current = get(input.projectId, input.publicationId, input.subjectId)
            if (!current) return { kind: 'not_found' } as const
            if (
                !current.canConfigure ||
                !(current.providerId === 'mastodon'
                    ? mastodonReplyTextValid(input.text)
                    : blueskyReplyTextValid(input.text))
            )
                return { kind: 'conflict' } as const
            return store.save({ ...input, recordKey: createBlueskyReplyRecordKey(), now: now() })
        },
        cancel(input: {
            projectId: string
            publicationId: string
            subjectId: string
            expectedRevision: number
        }) {
            const current = get(input.projectId, input.publicationId, input.subjectId)
            if (!current) return { kind: 'not_found' } as const
            if (
                !current.canManage ||
                !current.firstComment ||
                !editableStates.has(current.firstComment.state)
            )
                return { kind: 'conflict' } as const
            return store.cancel({ ...input, now: now() })
        },
        async processDueEvents() {
            store.reconcile(now())
            await processNextExternalEffect({
                store: store.deliveries,
                actorId: 'publication-first-comment-worker',
                leaseDuration: 120_000,
                retryPolicy: { nextRunAt: () => null },
                createClaimToken: () => crypto.randomUUID(),
                now,
                async performExternalEffect(work) {
                    const controller = new AbortController()
                    let timer: ReturnType<typeof setTimeout> | undefined
                    const deadline = new Promise<ExternalEffectOutcome>(resolve => {
                        timer = setTimeout(() => {
                            controller.abort()
                            resolve({
                                type: 'ambiguous',
                                errorMessage:
                                    'The first-comment outcome was not confirmed before the deadline',
                            })
                        }, 60_000)
                    })
                    try {
                        return await Promise.race([perform(work, controller.signal), deadline])
                    } finally {
                        clearTimeout(timer)
                    }
                },
            })
        },
    }
}
export type PublicationFirstCommentService = ReturnType<typeof createPublicationFirstCommentService>
