import {
    createBlueskyReplyRecordKey,
    type BlueskyFetcher,
    blueskyPostDid,
    blueskyReplyTextValid,
    type restoreBlueskySession,
} from '@postdot/bluesky'
import { processNextExternalEffect, type ExternalEffectOutcome } from '@postdot/core'
import {
    createAccessStore,
    createManualStore,
    createPublicationReplyStore,
    type PostbotDatabase,
    type PublicationReplyWork,
} from '@postdot/db'
import {
    resolveMastodonStatusReference,
    mastodonReplyStatusId,
    mastodonReplyTextValid,
} from '@postdot/mastodon'
import { Value } from 'typebox/value'

import type { PublisherRuntime } from '../publishers/runtime'
import { publicationCommentSnapshotSchema } from './publication-comments-models'
import { performBlueskyReply } from './publication-replies-bluesky'
import { performMastodonReply } from './publication-replies-mastodon'

export function createPublicationRepliesService(options: {
    database: PostbotDatabase
    publisher: PublisherRuntime
    now?: () => number
    restoreSession?: typeof restoreBlueskySession
    contextFetcher?: BlueskyFetcher
    performReply?: (
        work: PublicationReplyWork,
        signal: AbortSignal
    ) => Promise<ExternalEffectOutcome>
}) {
    const store = createPublicationReplyStore(options.database)
    const access = createAccessStore(options.database)
    const manual = createManualStore(options.database)
    const now = options.now ?? Date.now
    function identity(projectId: string, publicationId: string, subjectId: string) {
        const editor = manual.getPublicationEditorState(projectId, publicationId, subjectId)
        if (!editor || editor.publication.state !== 'published' || !editor.publication.externalId)
            return null
        const execution = editor.profile.profile.execution
        if (execution.kind !== 'built_in') return null
        if (execution.contractId === 'mastodon') {
            const reference = resolveMastodonStatusReference(
                editor.publication.externalId,
                editor.publication.externalUrl
            )
            return reference
                ? {
                      providerId: 'mastodon' as const,
                      rootUri: reference.rootUri,
                      did: null,
                      origin: reference.origin,
                      channelId: editor.publication.channelId,
                  }
                : null
        }
        if (execution.contractId !== 'bluesky') return null
        const did = blueskyPostDid(editor.publication.externalId)
        return did
            ? {
                  providerId: 'bluesky' as const,
                  origin: null,
                  rootUri: editor.publication.externalId,
                  did,
                  channelId: editor.publication.channelId,
              }
            : null
    }
    function connection(projectId: string, publicationId: string, subjectId: string) {
        const source = identity(projectId, publicationId, subjectId)
        if (!source) return null
        const connected = options.publisher.publisherStore.getPublisherConnection(
            projectId,
            source.channelId,
            subjectId
        )
        if (
            !connected ||
            connected.state !== 'active' ||
            connected.kind !== source.providerId ||
            connected.providerId !== source.providerId ||
            (connected.destination?.id ?? connected.externalAccountId) !==
                connected.externalAccountId
        )
            return null
        if (source.providerId === 'bluesky' && connected.externalAccountId !== source.did)
            return null
        if (
            source.providerId === 'mastodon' &&
            (connected.endpointUrl !== source.origin ||
                !connected.scopes.some(scope => scope === 'write' || scope === 'write:statuses'))
        )
            return null
        return { source, connected }
    }
    async function perform(
        work: PublicationReplyWork,
        signal: AbortSignal
    ): Promise<ExternalEffectOutcome> {
        let dispatched = false
        try {
            const author = options.database.$client
                .query<{ subjectId: string | null }, [string, string]>(
                    'select subject_id as subjectId from actors where project_id = ?1 and id = ?2'
                )
                .get(work.projectId, work.actorId)
            const pinned = author?.subjectId
                ? connection(work.projectId, work.publicationId, author.subjectId)
                : null
            if (
                !pinned ||
                pinned.connected.id !== work.connectionId ||
                pinned.connected.credentialId !== work.credentialId ||
                pinned.source.providerId !== work.providerId ||
                pinned.source.rootUri !== work.rootUri ||
                pinned.connected.externalAccountId !== work.accountId ||
                pinned.source.origin !== work.instanceOrigin ||
                !store.claimCurrent(work, now())
            )
                return failed('The original account or editor access is no longer available')
            if (options.performReply) {
                dispatched = true
                return await options.performReply(work, signal)
            }
            if (work.providerId === 'mastodon') {
                return await performMastodonReply({
                    work,
                    publisher: options.publisher,
                    signal,
                    stillEligible: () => store.claimCurrent(work, now()),
                    onDispatch: () => {
                        dispatched = true
                    },
                    now: now(),
                })
            }
            return await performBlueskyReply({
                work,
                publisher: options.publisher,
                restoreSession: options.restoreSession,
                contextFetcher: options.contextFetcher,
                signal,
                stillEligible: () => store.claimCurrent(work, now()),
                onDispatch: () => {
                    dispatched = true
                },
            })
        } catch {
            if (dispatched)
                return {
                    type: 'ambiguous',
                    errorMessage: 'The reply outcome could not be confirmed',
                }
            return failed('The connection or reply context could not be prepared')
        }
    }
    async function processDueEvent(projectId?: string): Promise<boolean> {
        const result = await processNextExternalEffect({
            store: store.deliveries,
            projectId,
            actorId: 'publication-reply-worker',
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
        getNextEventAt: store.getNextEventAt,
        list(projectId: string, publicationId: string, subjectId: string, before?: string) {
            const source = identity(projectId, publicationId, subjectId)
            if (!source) return null
            const page = store.list(projectId, publicationId, subjectId, before)
            if (!page) return null
            const ready = connection(projectId, publicationId, subjectId)
            return {
                ...page,
                provider: source.providerId,
                textLimit: source.providerId === 'mastodon' ? 500 : 300,
                instanceOrigin: source.origin,
                canReply: ready !== null && access.canAccessProject(projectId, subjectId, 'editor'),
                accountName: ready?.connected.externalAccountName ?? ready?.source.did ?? null,
            }
        },
        create(input: {
            projectId: string
            publicationId: string
            subjectId: string
            requestId: string
            parentUri: string
            text: string
        }) {
            const source = identity(input.projectId, input.publicationId, input.subjectId)
            if (
                !source ||
                !(source.providerId === 'bluesky'
                    ? blueskyReplyTextValid(input.text)
                    : mastodonReplyTextValid(input.text))
            )
                return null
            if (
                source.providerId === 'mastodon' &&
                !mastodonReplyStatusId(input.parentUri, source.origin!)
            )
                return null
            // Retrying an accepted request after a lost HTTP response must return that same request.
            const existing = store.get(input.requestId)
            if (existing) {
                const page = store.list(input.projectId, input.publicationId, input.subjectId)
                return page &&
                    existing.projectId === input.projectId &&
                    existing.publicationId === input.publicationId &&
                    existing.text === input.text &&
                    existing.parentUri === input.parentUri
                    ? store.create({ ...existing, subjectId: input.subjectId, now: now() })
                    : null
            }
            const ready = connection(input.projectId, input.publicationId, input.subjectId)
            if (!ready) return null
            const snapshot = options.database.$client
                .query<{ snapshot: string | null }, [string, string, string]>(
                    'select snapshot_json as snapshot from publication_comment_snapshots where project_id = ?1 and publication_id = ?2 and root_uri = ?3'
                )
                .get(input.projectId, input.publicationId, ready.source.rootUri)
            let includesParent = false
            try {
                const decoded: unknown = JSON.parse(snapshot?.snapshot ?? 'null')
                includesParent =
                    Value.Check(publicationCommentSnapshotSchema, decoded) &&
                    decoded.availability === 'available' &&
                    decoded.rootUri === ready.source.rootUri &&
                    decoded.comments.some(
                        comment =>
                            comment?.id === input.parentUri && comment.availability === 'available'
                    )
            } catch {
                return null
            }
            if (!includesParent) return null
            return store.create({
                id: input.requestId,
                projectId: input.projectId,
                publicationId: input.publicationId,
                subjectId: input.subjectId,
                text: input.text,
                rootUri: ready.source.rootUri,
                parentUri: input.parentUri,
                connectionId: ready.connected.id,
                credentialId: ready.connected.credentialId,
                providerId: ready.source.providerId,
                instanceOrigin: ready.source.origin,
                accountId: ready.connected.externalAccountId,
                recordKey:
                    ready.source.providerId === 'bluesky'
                        ? createBlueskyReplyRecordKey()
                        : input.requestId,
                now: now(),
            })
        },
        processDueEvent,
        async processDueEvents() {
            await processDueEvent()
        },
    }
}
function failed(errorMessage: string): ExternalEffectOutcome {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
export type PublicationRepliesService = ReturnType<typeof createPublicationRepliesService>
