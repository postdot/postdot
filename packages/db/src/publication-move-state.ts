import type { Publication } from '@postdot/core'

import type { PostbotDatabase } from './client'

export function publicationHasAttempt(
    database: PostbotDatabase,
    projectId: string,
    publicationId: string
): boolean {
    return (
        database.$client
            .query(`select 1 where
        exists(select 1 from jobs where project_id=?1 and publication_id=?2 and
            (state='running' or attempts>0 or claimed_at is not null or started_at is not null))
        or exists(select 1 from publication_execution_revisions where project_id=?1 and publication_id=?2)
        or exists(select 1 from audit_events where project_id=?1 and entity_id=?2 and action='publication.execution.claimed')
    `)
            .get(projectId, publicationId) !== null
    )
}
export interface PublicationMovement {
    canMove: boolean
    fromPublicationId: string | null
    toPublicationId: string | null
    requestedScheduledAt: number | null
}
export function readPublicationMovement(
    database: PostbotDatabase,
    publication: Pick<Publication, 'id' | 'projectId' | 'state' | 'scheduledAt'>,
    now: number
): PublicationMovement {
    const incoming = database.$client
        .query<{ source: string; at: number | null }, [string, string]>(
            `select source_publication_id as source,requested_scheduled_at as at from publication_moves where project_id=? and destination_publication_id=?`
        )
        .get(publication.projectId, publication.id)
    const outgoing = database.$client
        .query<{ destination: string; at: number | null }, [string, string]>(
            `select destination_publication_id as destination,requested_scheduled_at as at from publication_moves where project_id=? and source_publication_id=?`
        )
        .get(publication.projectId, publication.id)
    return {
        canMove:
            ['draft', 'scheduled', 'ready'].includes(publication.state) &&
            !outgoing &&
            (publication.scheduledAt === null || publication.scheduledAt > now) &&
            !publicationHasAttempt(database, publication.projectId, publication.id),
        fromPublicationId: incoming?.source ?? null,
        toPublicationId: outgoing?.destination ?? null,
        requestedScheduledAt: incoming?.at ?? outgoing?.at ?? null,
    }
}
