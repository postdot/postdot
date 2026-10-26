import { DomainInvariantError, requireTimestamp } from '@postdot/core'

import { readChannelDestination } from './channel-destination'
import {
    createDatabaseTransaction,
    recordDatabaseCommitProject,
    type PostbotDatabase,
} from './client'
import { createEventJournalStore } from './event-journal-store'

export interface PublicationDestinationState {
    readonly revision: number
    readonly confirmedRevision: number
    readonly requiresConfirmation: boolean
    readonly connected: boolean
    readonly current: ReturnType<typeof readChannelDestination>
    readonly history: readonly {
        readonly id: string
        readonly createdAt: number
        readonly destination: Record<string, unknown> | null
    }[]
}

export function createPublicationDestinationStore(
    database: PostbotDatabase,
    options: {
        createId?: () => string
        now: () => number
        loadActor: (projectId: string, subjectId: string) => { readonly id: string } | null
    }
) {
    const client = database.$client
    function load(projectId: string, publicationId: string) {
        return client
            .query<
                {
                    channelId: string
                    targetId: string | null
                    state: string
                    mode: string
                    revision: number
                    confirmedRevision: number
                    channelState: string
                },
                [string, string]
            >(`
            select p.channel_id as channelId, p.target_revision_id as targetId, p.state, p.delivery_mode as mode,
                   c.destination_revision as revision, p.confirmed_destination_revision as confirmedRevision,
                   c.state as channelState
            from publications p join channels c on c.project_id = p.project_id and c.id = p.channel_id
            where p.project_id = ? and p.id = ?
        `)
            .get(projectId, publicationId)
    }
    function read(
        projectId: string,
        publicationId: string,
        subjectId: string
    ): PublicationDestinationState | null {
        if (options.loadActor(projectId, subjectId) === null) return null
        const row = load(projectId, publicationId)
        if (row === null) return null
        const current = readChannelDestination(database, projectId, row.channelId)
        return {
            revision: row.revision,
            confirmedRevision: row.confirmedRevision,
            requiresConfirmation:
                row.mode === 'automatic' &&
                ['draft', 'scheduled', 'ready', 'failed'].includes(row.state) &&
                row.revision !== row.confirmedRevision,
            connected:
                client
                    .query<{ state: string }, [string, string]>(`
                select cr.state from publisher_connections pc
                join publishers pub on pub.project_id = pc.project_id and pub.id = pc.publisher_id
                join publisher_credentials cr on cr.project_id = pc.project_id and cr.id = pc.credential_id
                where pub.project_id = ? and pub.channel_id = ?
            `)
                    .get(projectId, row.channelId)?.state === 'active',
            current,
            history: client
                .query<{ id: string; createdAt: number; json: string | null }, [string, string]>(`
                select id, created_at as createdAt, destination_snapshot_json as json
                from publication_execution_revisions where project_id = ? and publication_id = ? order by created_at, id
            `)
                .all(projectId, publicationId)
                .map(({ id, createdAt, json }) => ({
                    id,
                    createdAt,
                    destination: json === null ? null : JSON.parse(json),
                })),
        }
    }
    const confirm = createDatabaseTransaction(
        database,
        (input: {
            projectId: string
            publicationId: string
            subjectId: string
            expectedRevision: number
            expectedTargetRevisionId: string | null
        }) => {
            const actor = options.loadActor(input.projectId, input.subjectId)
            const row = load(input.projectId, input.publicationId)
            if (actor === null || row === null) return null
            const state = read(input.projectId, input.publicationId, input.subjectId)!
            if (
                row.revision !== input.expectedRevision ||
                row.targetId !== input.expectedTargetRevisionId
            )
                throw new DomainInvariantError(
                    'write_conflict',
                    'The destination or selected target changed; review it again'
                )
            if (
                client
                    .query(`select 1 from resource_lifecycles r where r.state <> 'active' and
                    ((r.kind = 'project' and r.resource_id = ?) or (r.kind = 'workspace' and r.resource_id = (select workspace_id from projects where id = ?)))`)
                    .get(input.projectId, input.projectId) !== null ||
                row.mode !== 'automatic' ||
                row.channelState !== 'active' ||
                !state.connected ||
                !['draft', 'scheduled', 'ready', 'failed'].includes(row.state) ||
                client
                    .query(
                        "select id from jobs where project_id = ? and publication_id = ? and state = 'running' limit 1"
                    )
                    .get(input.projectId, input.publicationId)
            )
                throw new DomainInvariantError(
                    'invalid_transition',
                    'The destination cannot be confirmed in the current state'
                )
            if (row.confirmedRevision === row.revision) return state
            const at = requireTimestamp(options.now(), 'now')
            client
                .query(
                    'update publications set confirmed_destination_revision = ?, updated_at = ? where project_id = ? and id = ?'
                )
                .run(row.revision, at, input.projectId, input.publicationId)
            // A retry may already have pinned an earlier execution. Preserve that row
            // and start a fresh job rather than reinterpret its immutable snapshot.
            const oldRetry = client
                .query<{ id: string; runAt: number }, [string, string, number]>(`
                select j.id, j.run_at as runAt from jobs j
                join publication_execution_revisions e on e.project_id = j.project_id and e.job_id = j.id
                where j.project_id = ? and j.publication_id = ? and j.state = 'pending'
                  and coalesce(json_extract(e.destination_snapshot_json, '$.revision'), 0) <> ?
            `)
                .get(input.projectId, input.publicationId, row.revision)
            const replacementJobId =
                oldRetry === null ? null : (options.createId ?? crypto.randomUUID)()
            if (oldRetry !== null) {
                client
                    .query(
                        "update jobs set state = 'cancelled', completed_at = ?, updated_at = ? where id = ? and state = 'pending'"
                    )
                    .run(at, at, oldRetry.id)
                client
                    .query(
                        "insert into jobs (id, project_id, publication_id, state, run_at, created_at, updated_at) values (?,?,?,'pending',?,?,?)"
                    )
                    .run(
                        replacementJobId!,
                        input.projectId,
                        input.publicationId,
                        oldRetry.runAt,
                        at,
                        at
                    )
            }
            createEventJournalStore(database).append({
                projectId: input.projectId,
                actorId: actor.id,
                name: 'publication.destination_confirmed',
                version: 1,
                subject: { type: 'publication', id: input.publicationId },
                occurredAt: at,
                payload: {
                    fromRevision: row.confirmedRevision,
                    revision: row.revision,
                    targetRevisionId: row.targetId,
                    replacedJobId: oldRetry?.id ?? null,
                    replacementJobId,
                },
            })
            recordDatabaseCommitProject(database, input.projectId)
            return read(input.projectId, input.publicationId, input.subjectId)
        }
    )
    return {
        getPublicationDestination: read,
        confirmPublicationDestination: (input: Parameters<typeof confirm>[0]) =>
            confirm.immediate(input),
    }
}
