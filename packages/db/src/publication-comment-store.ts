import { requireNonBlank, requireTimestamp } from '@postdot/core'

import { createAccessStore } from './access-store'
import type { DatabaseHandle } from './client'

export interface PublicationCommentRecord {
    readonly snapshotJson: string | null
    readonly lastAttemptAt: number
    readonly lastError: string | null
}

interface CommentIdentity {
    readonly projectId: string
    readonly publicationId: string
    readonly subjectId: string
    readonly rootUri: string
    readonly externalId: string
    readonly externalUrl?: string
}

export function createPublicationCommentStore(database: DatabaseHandle) {
    const access = createAccessStore(database)
    const publication = database.sql.statement<
        { id: string },
        [string, string, string, string | null]
    >(
        "select id from publications where project_id = ?1 and id = ?2 and external_id = ?3 and (cast(?4 as text) is null or external_url = ?4) and state = 'published'"
    )
    const read = database.sql.statement<PublicationCommentRecord, [string, string, string]>(
        'select snapshot_json as snapshotJson, last_attempt_at as lastAttemptAt, last_error as lastError from publication_comment_snapshots where project_id = ?1 and publication_id = ?2 and root_uri = ?3'
    )
    const save = database.sql.statement<
        never,
        [string, string, string, string | null, number, string | null]
    >(`
        insert into publication_comment_snapshots (project_id, publication_id, root_uri, snapshot_json, last_attempt_at, last_error)
        values (?1, ?2, ?3, ?4, ?5, ?6)
        on conflict(project_id, publication_id) do update set
            snapshot_json = case when publication_comment_snapshots.root_uri = excluded.root_uri then coalesce(excluded.snapshot_json, publication_comment_snapshots.snapshot_json) else excluded.snapshot_json end,
            root_uri = excluded.root_uri,
            last_attempt_at = excluded.last_attempt_at,
            last_error = excluded.last_error
        where publication_comment_snapshots.last_attempt_at <= excluded.last_attempt_at
    `)
    async function eligible(input: CommentIdentity, role: 'viewer' | 'editor') {
        requireNonBlank(input.rootUri, 'comment root URI')
        return (
            (await access.canAccessProject(input.projectId, input.subjectId, role)) &&
            (await publication.get(
                input.projectId,
                input.publicationId,
                input.externalId,
                input.externalUrl ?? null
            )) !== null
        )
    }
    return {
        async read(input: CommentIdentity): Promise<PublicationCommentRecord | null | undefined> {
            return database.sql.transaction(async () => {
                if (!(await eligible(input, 'viewer'))) return undefined
                return await read.get(input.projectId, input.publicationId, input.rootUri)
            }, 'deferred')
        },
        async saveAttempt(input: CommentIdentity & PublicationCommentRecord): Promise<boolean> {
            return database.sql.transaction(async () => {
                requireTimestamp(input.lastAttemptAt, 'comment refresh timestamp')
                if (!(await eligible(input, 'editor'))) return false
                await save.run(
                    input.projectId,
                    input.publicationId,
                    input.rootUri,
                    input.snapshotJson,
                    input.lastAttemptAt,
                    input.lastError
                )
                return true
            }, 'immediate')
        },
    }
}

export type PublicationCommentStore = ReturnType<typeof createPublicationCommentStore>
