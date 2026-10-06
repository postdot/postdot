import type { PublicationEditorState } from '@/lib/api'

export type PublicationPromotionIntent =
    | 'select_version'
    | 'schedule'
    | 'update_schedule'
    | 'return_draft'

export function publicationPromotionIntent(
    state: PublicationEditorState['publication']['state'],
    hasSchedule: boolean
): PublicationPromotionIntent {
    if (hasSchedule) return state === 'scheduled' ? 'update_schedule' : 'schedule'
    return state === 'scheduled' ? 'return_draft' : 'select_version'
}

export const activeChannelProfilePromotionErrorPrefix =
    'Publication target content is incompatible with the active channel profile'

export function isActiveChannelProfilePromotionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const { code, message } = error as { code?: unknown; message?: unknown }
    return (
        code === 'invalid_content' &&
        typeof message === 'string' &&
        message.startsWith(activeChannelProfilePromotionErrorPrefix)
    )
}
