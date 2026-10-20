import { Agent } from '@atproto/api'
import {
    createBlueskyReplyRecordKey,
    type BlueskyFetcher,
    blueskyPostDid,
    blueskyReplyTextValid,
    createBlueskyReplyPublisher,
    resolveBlueskyReplyContext,
    readBlueskySessionTokenSet,
    restoreBlueskySession,
} from '@postbot/bluesky'
import { processNextExternalEffect, type ExternalEffectOutcome } from '@postbot/core'
import {
    createAccessStore,
    createManualStore,
    createPublicationReplyStore,
    type PostbotDatabase,
    type PublicationReplyWork,
} from '@postbot/db'
import { Value } from 'typebox/value'

import type { PublisherRuntime } from '../publishers/runtime'
import { publicationCommentSnapshotSchema } from './publication-comments-models'

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
        if (execution.kind !== 'built_in' || execution.contractId !== 'bluesky') return null
        const did = blueskyPostDid(editor.publication.externalId)
        return did
            ? {
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
        return connected?.state === 'active' &&
            connected.kind === 'bluesky' &&
            connected.providerId === 'bluesky' &&
            connected.externalAccountId === source.did &&
            (connected.destination?.id ?? connected.externalAccountId) === source.did
            ? { source, connected }
            : null
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
                !store.claimCurrent(work, now())
            )
                return failed(
                    'The original Bluesky account or editor access is no longer available'
                )
            if (options.performReply) {
                dispatched = true
                return await options.performReply(work, signal)
            }
            const oauth = await options.publisher.resolveBlueskyOAuth(
                options.publisher.credentialStore.getPublisherCredential(
                    work.projectId,
                    work.credentialId
                )?.providerApplicationId ?? null
            )
            const secrets =
                await options.publisher.credentialStore.resolvePublisherCredentialSecrets(
                    work.projectId,
                    work.credentialId
                )
            if (!oauth || !secrets?.providerSession)
                return failed('Reconnect the original Bluesky account to reply')
            const restored = await (options.restoreSession ?? restoreBlueskySession)({
                sub: work.accountDid,
                serializedSession: secrets.providerSession,
                client: oauth,
            })
            const grant = await restored.session.getTokenInfo()
            if (
                restored.session.did !== work.accountDid ||
                !grant.scope
                    .split(/\s+/)
                    .some(
                        scope =>
                            scope === 'repo:app.bsky.feed.post?action=create' ||
                            scope === 'transition:generic'
                    )
            )
                return failed('The Bluesky account has not granted permission to create replies')
            const serialized = restored.getSerializedSession()
            const token = readBlueskySessionTokenSet(serialized)
            if (!token || token.sub !== work.accountDid)
                return failed('The Bluesky session is invalid')
            if (serialized !== secrets.providerSession) {
                const result =
                    await options.publisher.credentialStore.replacePublisherCredentialTokens({
                        projectId: work.projectId,
                        credentialId: work.credentialId,
                        accessToken: token.accessToken,
                        refreshToken: token.refreshToken ?? undefined,
                        providerSession: serialized,
                        expiresAt:
                            token.expiresAt === null
                                ? null
                                : Number.isSafeInteger(Date.parse(token.expiresAt))
                                  ? Date.parse(token.expiresAt)
                                  : null,
                    })
                if (result.kind !== 'updated')
                    return failed('The refreshed Bluesky session could not be saved')
            }
            const context = await resolveBlueskyReplyContext({
                rootUri: work.rootUri,
                parentUri: work.parentUri,
                signal,
                fetcher: options.contextFetcher,
            })
            if (!context) return failed('The comment or its conversation is no longer available')
            if (signal.aborted || !store.claimCurrent(work, now()))
                return failed('The reply is no longer eligible for dispatch')
            const agent = new Agent(restored.session)
            dispatched = true
            return await createBlueskyReplyPublisher({
                did: agent.did,
                createRecord: (input, callOptions) =>
                    agent.com.atproto.repo.createRecord(input, callOptions),
            }).publish(
                {
                    ...context,
                    text: work.text,
                    recordKey: work.recordKey,
                    createdAt: work.createdAt,
                },
                signal
            )
        } catch {
            if (dispatched)
                return {
                    type: 'ambiguous',
                    errorMessage: 'The reply outcome could not be confirmed',
                }
            return failed('The Bluesky connection or reply context could not be prepared')
        }
    }
    return {
        store,
        getNextEventAt: store.getNextEventAt,
        list(projectId: string, publicationId: string, subjectId: string, before?: string) {
            if (!identity(projectId, publicationId, subjectId)) return null
            const page = store.list(projectId, publicationId, subjectId, before)
            if (!page) return null
            const ready = connection(projectId, publicationId, subjectId)
            return {
                ...page,
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
            if (!blueskyReplyTextValid(input.text)) return null
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
                accountDid: ready.source.did,
                recordKey: createBlueskyReplyRecordKey(),
                now: now(),
            })
        },
        async processDueEvents() {
            for (let count = 0; count < 1; count++) {
                const result = await processNextExternalEffect({
                    store: store.deliveries,
                    actorId: 'publication-reply-worker',
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
                                        'The reply outcome could not be confirmed before the deadline',
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
                if (result.outcome === 'idle') break
            }
        },
    }
}
function failed(errorMessage: string): ExternalEffectOutcome {
    return { type: 'permanent_failure', effectOccurred: false, errorMessage }
}
export type PublicationRepliesService = ReturnType<typeof createPublicationRepliesService>
