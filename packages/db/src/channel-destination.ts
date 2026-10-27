import { createHash } from 'node:crypto'

import type { PostdotDatabase } from './client'

export interface ChannelDestinationIdentity {
    readonly providerId: string
    readonly externalAccountId: string
    readonly externalAccountName: string | null
    readonly destinationType: string | null
    readonly destinationId: string | null
    readonly destinationName: string | null
    readonly endpointOrigin: string | null
    readonly endpointHash: string | null
}

function publicEndpointOrigin(value: string | null): string | null {
    if (value === null) return null
    try {
        const url = new URL(value)
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
    } catch {
        return null
    }
}

/** Non-secret identity only. Keep the public origin, never URL credentials, paths or queries. */
export function destinationIdentity(input: {
    providerId: string
    externalAccountId: string
    externalAccountName: string | null
    destinationType: string | null
    destinationId: string | null
    destinationName: string | null
    endpointUrl: string | null
}): ChannelDestinationIdentity {
    return {
        providerId: input.providerId,
        externalAccountId: input.externalAccountId,
        externalAccountName: input.externalAccountName,
        destinationType: input.destinationType,
        destinationId: input.destinationId,
        destinationName: input.destinationName,
        endpointOrigin: publicEndpointOrigin(input.endpointUrl),
        endpointHash:
            input.endpointUrl === null
                ? null
                : createHash('sha256').update(input.endpointUrl).digest('hex'),
    }
}

export function sameDestination(
    left: ChannelDestinationIdentity,
    right: ChannelDestinationIdentity
) {
    return (
        left.providerId === right.providerId &&
        left.externalAccountId === right.externalAccountId &&
        left.destinationType === right.destinationType &&
        left.destinationId === right.destinationId &&
        left.endpointHash === right.endpointHash
    )
}

export function readChannelDestination(
    database: PostdotDatabase,
    projectId: string,
    channelId: string
) {
    const row = database.$client
        .query<
            {
                providerId: string
                externalAccountId: string
                externalAccountName: string | null
                destinationType: string | null
                destinationId: string | null
                destinationName: string | null
                endpointUrl: string | null
            },
            [string, string]
        >(`
        select cr.provider_id as providerId, cr.external_account_id as externalAccountId,
               cr.external_account_name as externalAccountName, c.destination_type as destinationType,
               c.destination_id as destinationId, c.destination_name as destinationName, c.endpoint_url as endpointUrl
        from project_publisher_connection_contexts c
        join project_publisher_contexts p on p.project_id = c.project_id and p.id = c.publisher_id
        join project_publisher_credential_contexts cr on cr.project_id = c.project_id and cr.id = c.credential_id
        where p.project_id = ? and p.channel_id = ?
    `)
        .get(projectId, channelId)
    return row === null ? null : destinationIdentity(row)
}

/** This predicate is shared by claim, effect admission, retry and public state reads. */
export function publicationDestinationConfirmed(
    database: PostdotDatabase,
    projectId: string,
    publicationId: string
) {
    return (
        database.$client
            .query<{ confirmed: number }, [string, string]>(`
        select p.confirmed_destination_revision = c.destination_revision as confirmed
        from publications p join project_channel_contexts c on c.project_id = p.project_id and c.id = p.channel_id
        where p.project_id = ? and p.id = ?
    `)
            .get(projectId, publicationId)?.confirmed === 1
    )
}
