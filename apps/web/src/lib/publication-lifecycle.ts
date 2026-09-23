import type { Publication } from '@/lib/api'

const editablePublicationStates = new Set<Publication['state']>(['draft', 'scheduled', 'failed'])

export function canEditPublication(state: Publication['state']): boolean {
    return editablePublicationStates.has(state)
}

export function isManualPublicationDue(
    publication: Pick<Publication, 'deliveryMode' | 'scheduledAt' | 'state'>,
    now = Date.now()
): boolean {
    return (
        publication.deliveryMode === 'manual' &&
        publication.state === 'scheduled' &&
        publication.scheduledAt !== null &&
        publication.scheduledAt <= now
    )
}
