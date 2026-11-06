import type { Publication } from '@postdot/core'

import type { PostdotDatabase } from './client'

export async function publicationHasAttempt(
    database: PostdotDatabase,
    projectId: string,
    publicationId: string
): Promise<boolean> {
    return (
        (await database.sql
            .statement(`select 1 where
        exists(select 1 from jobs where project_id=?1 and publication_id=?2 and
            (state='running' or attempts>0 or claimed_at is not null or started_at is not null))
        or exists(select 1 from publication_execution_revisions where project_id=?1 and publication_id=?2)
        or exists(select 1 from audit_events where project_id=?1 and entity_id=?2 and action='publication.execution.claimed')
    `)
            .get(projectId, publicationId)) !== null
    )
}
export interface PublicationMovement {
    canMove: boolean
    fromPublicationId: string | null
    toPublicationId: string | null
    requestedScheduledAt: number | null
}
export async function readPublicationMovement(
    database: PostdotDatabase,
    publication: Pick<Publication, 'id' | 'projectId' | 'state' | 'scheduledAt'>,
    now: number
): Promise<PublicationMovement> {
    const incoming = await database.sql
        .statement<{ source: string; at: number | null }, [string, string]>(
            `select source_publication_id as source,requested_scheduled_at as at from publication_moves where project_id=? and destination_publication_id=?`
        )
        .get(publication.projectId, publication.id)
    const outgoing = await database.sql
        .statement<{ destination: string; at: number | null }, [string, string]>(
            `select destination_publication_id as destination,requested_scheduled_at as at from publication_moves where project_id=? and source_publication_id=?`
        )
        .get(publication.projectId, publication.id)
    return {
        canMove:
            ['draft', 'scheduled', 'ready'].includes(publication.state) &&
            !outgoing &&
            (publication.scheduledAt === null || publication.scheduledAt > now) &&
            !(await publicationHasAttempt(database, publication.projectId, publication.id)),
        fromPublicationId: incoming?.source ?? null,
        toPublicationId: outgoing?.destination ?? null,
        requestedScheduledAt: incoming?.at ?? outgoing?.at ?? null,
    }
}
