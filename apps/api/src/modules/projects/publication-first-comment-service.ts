import type { BlueskyFetcher, restoreBlueskySession } from '@postdot/bluesky'
import { processNextExternalEffect, type ExternalEffectOutcome } from '@postdot/core'
import {
    createAccessStore,
    createManualStore,
    createPublicationFirstCommentStore,
    type DatabaseHandle,
    type PublicationFirstComment,
} from '@postdot/db'

import { providerEngagement } from '../../providers/engagement-registry'
import { providerCommentPolicies, commentPolicy } from '../../providers/registry'
import type { PublisherRuntime } from '../publishers/runtime'
import type {
    PublicationFirstCommentResponse,
    PublicationFirstCommentSave,
} from './publication-first-comment-models'

const editableStates = new Set(['waiting', 'pending', 'suspended'])
const failed = (errorMessage: string): ExternalEffectOutcome => ({
    type: 'permanent_failure',
    effectOccurred: false,
    errorMessage,
})

export function createPublicationFirstCommentService(options: {
    readonly database: DatabaseHandle
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
        policies: providerCommentPolicies,
    })
    const access = createAccessStore(options.database)
    const manual = createManualStore(options.database)
    const now = options.now ?? Date.now
    async function get(
        projectId: string,
        publicationId: string,
        subjectId: string
    ): Promise<PublicationFirstCommentResponse | null> {
        const editor = await manual.getPublicationEditorState(projectId, publicationId, subjectId)
        if (!editor) return null
        const row = await store.get(projectId, publicationId, subjectId)
        const execution = editor.profile.profile.execution
        const nativeProvider =
            execution.kind === 'built_in' ? (commentPolicy(execution.contractId)?.id ?? null) : null
        const capability = commentPolicy(row?.providerId ?? nativeProvider ?? undefined)
        if (!capability) return null
        const providerId = capability.id
        const supported =
            nativeProvider !== null &&
            nativeProvider === providerId &&
            editor.publication.deliveryMode === 'automatic'
        if ((!supported && row === null) || !providerId) return null
        const canManage = await access.canAccessProject(projectId, subjectId, 'editor')
        const canConfigure =
            canManage &&
            supported &&
            (row === null
                ? ['draft', 'scheduled'].includes(editor.publication.state)
                : editableStates.has(row.state))
        const author =
            row === null
                ? null
                : await options.database.sql
                      .statement<{ name: string }, [string, string]>(
                          'select display_name as name from actors where project_id = ?1 and id = ?2'
                      )
                      .get(projectId, row.actorId)
        return {
            providerId,
            textLimit: capability.textLimit,
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
                !(await store.claimCurrent(work, now()))
            )
                return failed('The first comment is no longer eligible for dispatch')
            if (options.performComment) {
                dispatched = true
                return await options.performComment(work, signal)
            }
            const provider = providerEngagement(work.providerId)
            if (!provider) return failed('The comment provider is unavailable')
            return await provider.firstComment(
                {
                    ...work,
                    rootUri: work.rootUri,
                    credentialId: work.credentialId,
                    accountId: work.accountId,
                },
                {
                    publisher: options.publisher,
                    restoreSession: options.restoreSession,
                    contextFetcher: options.contextFetcher,
                    signal,
                    now: now(),
                    stillEligible: async () => await store.claimCurrent(work, now()),
                    onDispatch: () => {
                        dispatched = true
                    },
                }
            )
        } catch {
            return dispatched
                ? {
                      type: 'ambiguous',
                      errorMessage: 'The first-comment outcome could not be confirmed',
                  }
                : failed('The original account or parent could not be prepared')
        }
    }
    async function processDueEvent(projectId?: string): Promise<boolean> {
        await store.reconcile(now())
        const result = await processNextExternalEffect({
            store: store.deliveries,
            projectId,
            actorId: 'publication-first-comment-worker',
            leaseDuration: 120_000,
            activeEffectPolicy: { renewalIntervalMs: 30_000, timeoutMs: 60_000 },
            retryPolicy: { nextRunAt: () => null },
            createClaimToken: () => crypto.randomUUID(),
            now,
            performExternalEffect: (work, context) => perform(work, context.signal),
        })
        return result.workId !== null
    }
    return {
        store,
        get,
        getNextEventAt: () => store.getNextEventAt(now()),
        async save(
            input: PublicationFirstCommentSave & {
                projectId: string
                publicationId: string
                subjectId: string
            }
        ) {
            const current = await get(input.projectId, input.publicationId, input.subjectId)
            if (!current) return { kind: 'not_found' } as const
            if (
                !current.canConfigure ||
                providerEngagement(current.providerId)?.textValid(input.text) !== true
            )
                return { kind: 'conflict' } as const
            return store.save({
                ...input,
                recordKey: providerEngagement(current.providerId)!.recordKey(crypto.randomUUID()),
                now: now(),
            })
        },
        async cancel(input: {
            projectId: string
            publicationId: string
            subjectId: string
            expectedRevision: number
        }) {
            const current = await get(input.projectId, input.publicationId, input.subjectId)
            if (!current) return { kind: 'not_found' } as const
            if (
                !current.canManage ||
                !current.firstComment ||
                !editableStates.has(current.firstComment.state)
            )
                return { kind: 'conflict' } as const
            return store.cancel({ ...input, now: now() })
        },
        processDueEvent,
        async processDueEvents() {
            await processDueEvent()
        },
    }
}
export type PublicationFirstCommentService = ReturnType<typeof createPublicationFirstCommentService>
