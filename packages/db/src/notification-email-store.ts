import { createAccessStore } from './access-store'
import type { PostdotDatabase } from './client'
import {
    createEventJournalStore,
    eventJournalCursorSequence,
    parseEventJournalCursor,
} from './event-journal-store'
import {
    createNotificationDeliveryStore,
    type NotificationDelivery,
} from './notification-delivery-store'

const transportId = 'email'
const kinds = ['publication_failed', 'publication_ambiguous'] as const

export function createNotificationEmailStore(database: PostdotDatabase) {
    const access = createAccessStore(database)
    const journal = createEventJournalStore(database)
    const deliveries = createNotificationDeliveryStore(database, {
        transportId,
        acceptDestination: input => {
            const after = input.configuration.afterSequence
            return (
                access.canAccessProject(input.projectId, input.subjectId) &&
                typeof after === 'number' &&
                eventJournalCursorSequence(parseEventJournalCursor(input.cursor)) > after
            )
        },
    })
    const account = database.$client.query<{ email: string; verified: number }, [string]>(
        'select email, email_verified as verified from user where id = ?1 and coalesce(banned, 0) = 0'
    )
    const recipient = database.$client.query<{ userId: string; state: string }, [string, string]>(`
        select a.subject_id as userId, d.state from notification_destinations d
        join actors a on a.id = d.recipient_actor_id and a.project_id = d.project_id
        where d.project_id = ?1 and d.id = ?2 and d.transport_id = 'email'`)
    const latestDelivery = database.$client.query<
        { state: 'pending' | 'running' | 'delivered' | 'failed' | 'ambiguous' },
        [string, string]
    >(`
        select delivery.state from notification_deliveries delivery
        join notification_destinations destination on destination.id = delivery.destination_id and destination.project_id = delivery.project_id
        join actors a on a.id = destination.recipient_actor_id and a.project_id = destination.project_id
        where delivery.project_id = ?1 and a.subject_id = ?2 and destination.state = 'active' and destination.transport_id = 'email'
        order by delivery.created_at desc, delivery.id desc limit 1`)
    function preferences(projectId: string, userId: string) {
        if (!access.canAccessProject(projectId, userId)) return null
        const user = account.get(userId)
        return {
            enabled:
                deliveries
                    .listDestinations(projectId, userId)
                    ?.some(d => d.transportId === transportId && d.state === 'active') ?? false,
            lastDeliveryState: latestDelivery.get(projectId, userId)?.state ?? null,
            email: user?.email ?? null,
            verified: user?.verified === 1,
        }
    }
    const update = database.$client.transaction(
        (projectId: string, userId: string, enabled: boolean) => {
            const current = preferences(projectId, userId)
            if (current === null || (enabled && !current.verified)) return null
            if (current.enabled === enabled) return current
            for (const destination of deliveries.listDestinations(projectId, userId) ?? []) {
                if (destination.transportId === transportId)
                    deliveries.setDestinationState(projectId, destination.id, userId, 'disabled')
            }
            if (enabled) {
                const cursor = journal.latestCursor()
                const destination = deliveries.createDestination({
                    projectId,
                    subjectId: userId,
                    transportId,
                    label: 'Account email',
                    configuration: {
                        afterSequence: cursor === null ? 0 : eventJournalCursorSequence(cursor),
                    },
                })!
                for (const kind of kinds)
                    deliveries.subscribe({
                        projectId,
                        subjectId: userId,
                        destinationId: destination.id,
                        kind,
                        enabled: true,
                    })
            }
            return preferences(projectId, userId)
        }
    )
    return {
        deliveries,
        preferences,
        setEnabled: (projectId: string, userId: string, enabled: boolean) =>
            update.immediate(projectId, userId, enabled),
        resolveRecipient(delivery: NotificationDelivery): string | null {
            const owner = recipient.get(delivery.projectId, delivery.destinationId)
            if (
                owner === null ||
                owner.state !== 'active' ||
                !access.canAccessProject(delivery.projectId, owner.userId)
            )
                return null
            const user = account.get(owner.userId)
            return user?.verified === 1 ? user.email : null
        },
    }
}
export type NotificationEmailStore = ReturnType<typeof createNotificationEmailStore>
