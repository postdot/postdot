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
