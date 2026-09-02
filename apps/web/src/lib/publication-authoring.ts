import { toDateTimeLocal } from '@/lib/date-time'

export type DeliveryMode = 'manual' | 'automatic'

export interface PublicationTargetDraft {
    readonly id: string
    readonly channelId: string
    readonly content: string
    readonly deliveryMode: DeliveryMode
    readonly scheduledAt: string
}

export function createPublicationTarget(channelId = ''): PublicationTargetDraft {
    return {
        id: crypto.randomUUID(),
        channelId,
        content: '',
        deliveryMode: 'manual',
        scheduledAt: toDateTimeLocal(Date.now() + 60 * 60 * 1000),
    }
}
