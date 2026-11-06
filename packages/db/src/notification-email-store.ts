import { createAccessStore } from './access-store'
import type { PostdotDatabase } from './client'
import { defineTransaction } from './client'
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
        acceptDestination: async input => {
            const after = input.configuration.afterSequence
            return (
                (await access.canAccessProject(input.projectId, input.subjectId)) &&
                typeof after === 'number' &&
                eventJournalCursorSequence(parseEventJournalCursor(input.cursor)) > after
            )
        },
    })
    const account = database.sql.statement<{ email: string; verified: number }, [string]>(
        'select email, email_verified as verified from user where id = ?1 and coalesce(banned, 0) = 0'
    )
    const recipient = database.sql.statement<{ userId: string; state: string }, [string, string]>(`
        select a.subject_id as userId, d.state from notification_destinations d
        join actors a on a.id = d.recipient_actor_id and a.project_id = d.project_id
        where d.project_id = ?1 and d.id = ?2 and d.transport_id = 'email'`)
    const latestDelivery = database.sql.statement<
        { state: 'pending' | 'running' | 'delivered' | 'failed' | 'ambiguous' },
        [string, string]
    >(`
        select delivery.state from notification_deliveries delivery
        join notification_destinations destination on destination.id = delivery.destination_id and destination.project_id = delivery.project_id
        join actors a on a.id = destination.recipient_actor_id and a.project_id = destination.project_id
        where delivery.project_id = ?1 and a.subject_id = ?2 and destination.state = 'active' and destination.transport_id = 'email'
        order by delivery.created_at desc, delivery.id desc limit 1`)
    async function preferences(projectId: string, userId: string) {
        if (!(await access.canAccessProject(projectId, userId))) return null
        const user = await account.get(userId)
        return {
            enabled:
                (await deliveries.listDestinations(projectId, userId))?.some(
                    d => d.transportId === transportId && d.state === 'active'
                ) ?? false,
            lastDeliveryState: (await latestDelivery.get(projectId, userId))?.state ?? null,
            email: user?.email ?? null,
            verified: user?.verified === 1,
        }
    }
    const update = defineTransaction(
        database,
        async (projectId: string, userId: string, enabled: boolean) => {
            const current = await preferences(projectId, userId)
            if (current === null || (enabled && !current.verified)) return null
            if (current.enabled === enabled) return current
            for (const destination of (await deliveries.listDestinations(projectId, userId)) ??
                []) {
                if (destination.transportId === transportId)
                    await deliveries.setDestinationState(
                        projectId,
                        destination.id,
                        userId,
                        'disabled'
                    )
            }
            if (enabled) {
                const cursor = await journal.latestCursor()
                const destination = (await deliveries.createDestination({
                    projectId,
                    subjectId: userId,
                    transportId,
                    label: 'Account email',
                    configuration: {
                        afterSequence: cursor === null ? 0 : eventJournalCursorSequence(cursor),
                    },
                }))!
                for (const kind of kinds)
                    await deliveries.subscribe({
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
        async resolveRecipient(delivery: NotificationDelivery): Promise<string | null> {
            return database.sql.transaction(async () => {
                const owner = await recipient.get(delivery.projectId, delivery.destinationId)
                if (
                    owner === null ||
                    owner.state !== 'active' ||
                    !(await access.canAccessProject(delivery.projectId, owner.userId))
                )
                    return null
                const user = await account.get(owner.userId)
                return user?.verified === 1 ? user.email : null
            }, 'deferred')
        },
    }
}
export type NotificationEmailStore = ReturnType<typeof createNotificationEmailStore>
