import type { PublicationTargetDraft, DeliveryMode } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'

const recoveryVersion = 1 as const

export interface PublicationRecoveryState {
    readonly version: typeof recoveryVersion
    readonly savedAt: number
    readonly postTitle: string
    readonly postContent: string
    readonly sourceMedia: MediaSelection[]
    readonly publicationTargets: PublicationTargetDraft[]
    readonly publicationTagIds: string[]
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    readonly customizedTargetIds: string[]
    readonly customizedContentTargetIds: string[]
    readonly activePublicationTabId: string
}

export type PublicationComposerDraftContent = Omit<PublicationRecoveryState, 'version' | 'savedAt'>

export interface PublicationRecoveryInput {
    readonly postTitle: string
    readonly postContent: string
    readonly sourceMedia: readonly MediaSelection[]
    readonly publicationTargets: readonly PublicationTargetDraft[]
    readonly publicationTagIds: readonly string[]
    readonly defaultDeliveryMode: DeliveryMode
    readonly defaultScheduledAt: string
    readonly customizedTargetIds: ReadonlySet<string>
    readonly customizedContentTargetIds: ReadonlySet<string>
    readonly activePublicationTabId: string
}

export function publicationRecoveryKey(projectId: string) {
    return `herald:publication-composer:v${recoveryVersion}:${encodeURIComponent(projectId)}`
}

export function hasRecoverablePublicationContent(
    input: Pick<PublicationRecoveryInput, 'postContent' | 'sourceMedia' | 'publicationTargets'>
) {
    return (
        input.postContent.trim() !== '' ||
        input.sourceMedia.length > 0 ||
        input.publicationTargets.some(target => target.content.trim() !== '')
    )
}

export function readPublicationRecovery(projectId: string): PublicationRecoveryState | null {
    const storage = getStorage()
    if (storage === null) return null

    try {
        const raw = storage.getItem(publicationRecoveryKey(projectId))
        if (raw === null) return null
        const value: unknown = JSON.parse(raw)
        return isPublicationRecoveryState(value) ? value : null
    } catch {
        return null
    }
}

export function writePublicationRecovery(projectId: string, input: PublicationRecoveryInput) {
    const storage = getStorage()
    if (storage === null) return

    const key = publicationRecoveryKey(projectId)
    if (!hasRecoverablePublicationContent(input)) {
        try {
            storage.removeItem(key)
        } catch {
            // Storage can be unavailable in private browsing or embedded contexts.
        }
        return
    }

    const state: PublicationRecoveryState = {
        version: recoveryVersion,
        savedAt: Date.now(),
        postTitle: input.postTitle,
        postContent: input.postContent,
        sourceMedia: input.sourceMedia.map(selection => ({ ...selection })),
        publicationTargets: input.publicationTargets.map(target => ({ ...target })),
        publicationTagIds: [...input.publicationTagIds],
        defaultDeliveryMode: input.defaultDeliveryMode,
        defaultScheduledAt: input.defaultScheduledAt,
        customizedTargetIds: [...input.customizedTargetIds],
        customizedContentTargetIds: [...input.customizedContentTargetIds],
        activePublicationTabId: input.activePublicationTabId,
    }

    try {
        storage.setItem(key, JSON.stringify(state))
    } catch {
        // Recovery is best effort; a full or unavailable storage must not block editing.
    }
}

export function clearPublicationRecovery(projectId: string) {
    const storage = getStorage()
    if (storage === null) return

    try {
        storage.removeItem(publicationRecoveryKey(projectId))
    } catch {
        // Storage can be unavailable in private browsing or embedded contexts.
    }
}

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function isPublicationRecoveryState(value: unknown): value is PublicationRecoveryState {
    if (!isRecord(value)) return false
    if (
        value.version !== recoveryVersion ||
        !isSafeTimestamp(value.savedAt) ||
        typeof value.postTitle !== 'string' ||
        typeof value.postContent !== 'string' ||
        !isMediaSelectionArray(value.sourceMedia) ||
        !isPublicationTargetArray(value.publicationTargets) ||
        !isStringArray(value.publicationTagIds) ||
        !isDeliveryMode(value.defaultDeliveryMode) ||
        typeof value.defaultScheduledAt !== 'string' ||
        !isStringArray(value.customizedTargetIds) ||
        !isStringArray(value.customizedContentTargetIds) ||
        typeof value.activePublicationTabId !== 'string'
    ) {
        return false
    }
    return hasRecoverablePublicationContent({
        postContent: value.postContent,
        publicationTargets: value.publicationTargets,
        sourceMedia: value.sourceMedia,
    })
}

function isMediaSelectionArray(value: unknown): value is MediaSelection[] {
    return (
        Array.isArray(value) &&
        value.every(
            item =>
                isRecord(item) &&
                typeof item.assetId === 'string' &&
                item.assetId.trim() !== '' &&
                (item.accessibilityText === undefined || typeof item.accessibilityText === 'string')
        )
    )
}

function isPublicationTargetArray(value: unknown): value is PublicationTargetDraft[] {
    return (
        Array.isArray(value) &&
        value.every(
            item =>
                isRecord(item) &&
                typeof item.id === 'string' &&
                item.id.trim() !== '' &&
                typeof item.channelId === 'string' &&
                typeof item.content === 'string' &&
                isDeliveryMode(item.deliveryMode) &&
                typeof item.scheduledAt === 'string'
        )
    )
}

function isDeliveryMode(value: unknown): value is DeliveryMode {
    return value === 'manual' || value === 'automatic'
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isSafeTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
