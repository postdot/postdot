import type { PublicationTargetDraft, DeliveryMode } from '@/lib/publication-authoring'
import type { MediaSelection } from '@/lib/target-media'

const recoveryVersion = 1 as const

export interface PublicationRecoveryState {
    readonly version: typeof recoveryVersion
    readonly serverDraftRevision?: number
    readonly serverDraftId?: string
    readonly conflict?: boolean
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
    readonly activeContentScopeId?: string
}

export type PublicationComposerDraftContent = Omit<
    PublicationRecoveryState,
    'version' | 'savedAt' | 'serverDraftRevision' | 'serverDraftId' | 'conflict'
>

export interface PublicationRecoveryInput {
    readonly serverDraftRevision?: number
    readonly serverDraftId?: string
    readonly conflict?: boolean
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
    readonly activeContentScopeId: string
}

export function publicationRecoveryKey(projectId: string) {
    return `postdot:publication-composer:v${recoveryVersion}:${encodeURIComponent(projectId)}`
}

export function hasRecoverablePublicationContent(
    input: Pick<
        PublicationRecoveryInput,
        'postTitle' | 'postContent' | 'sourceMedia' | 'publicationTargets'
    >
) {
    return (
        input.postTitle.trim() !== '' ||
        input.postContent.trim() !== '' ||
        input.sourceMedia.length > 0 ||
        input.publicationTargets.some(target => target.content.trim() !== '')
    )
}

export function readPublicationRecovery(projectId: string): PublicationRecoveryState | null {
    for (const storage of recoveryStorages()) {
        try {
            const raw = storage.getItem(publicationRecoveryKey(projectId))
            if (raw === null) continue
            const value: unknown = JSON.parse(raw)
            if (isPublicationRecoveryState(value)) return value
        } catch {
            /* Try the other recovery copy when this storage is unavailable or corrupt. */
        }
    }
    return null
}

export function writePublicationRecovery(projectId: string, input: PublicationRecoveryInput) {
    const key = publicationRecoveryKey(projectId)
    if (!hasRecoverablePublicationContent(input)) {
        clearPublicationRecovery(projectId)
        return
    }

    const state: PublicationRecoveryState = {
        version: recoveryVersion,
        serverDraftRevision: input.serverDraftRevision,
        serverDraftId: input.serverDraftId,
        conflict: input.conflict,
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
        activeContentScopeId: input.activeContentScopeId,
    }

    const encoded = JSON.stringify(state)
    for (const storage of recoveryStorages()) {
        try {
            storage.setItem(key, encoded)
        } catch {
            /* Recovery is best effort. */
        }
    }
}

export function clearPublicationRecovery(projectId: string) {
    for (const storage of recoveryStorages()) {
        try {
            storage.removeItem(publicationRecoveryKey(projectId))
        } catch {
            /* Recovery is best effort. */
        }
    }
}

function recoveryStorages(): Storage[] {
    if (typeof window === 'undefined') return []
    const storages: Storage[] = []
    try {
        storages.push(window.sessionStorage)
    } catch {
        /* Shared storage may still be available. */
    }
    try {
        storages.push(window.localStorage)
    } catch {
        /* Tab storage may still be available. */
    }
    return storages
}

function isPublicationRecoveryState(value: unknown): value is PublicationRecoveryState {
    return (
        isRecord(value) &&
        value.version === recoveryVersion &&
        (value.serverDraftRevision === undefined ||
            (typeof value.serverDraftRevision === 'number' &&
                Number.isSafeInteger(value.serverDraftRevision) &&
                value.serverDraftRevision >= 0)) &&
        (value.serverDraftId === undefined || typeof value.serverDraftId === 'string') &&
        (value.conflict === undefined || typeof value.conflict === 'boolean') &&
        isSafeTimestamp(value.savedAt) &&
        isPublicationComposerDraftContent(value) &&
        hasRecoverablePublicationContent(value)
    )
}

export function isPublicationComposerDraftContent(
    value: unknown
): value is PublicationComposerDraftContent {
    return (
        isRecord(value) &&
        typeof value.postTitle === 'string' &&
        typeof value.postContent === 'string' &&
        isMediaSelectionArray(value.sourceMedia) &&
        isPublicationTargetArray(value.publicationTargets) &&
        isStringArray(value.publicationTagIds) &&
        isDeliveryMode(value.defaultDeliveryMode) &&
        typeof value.defaultScheduledAt === 'string' &&
        isStringArray(value.customizedTargetIds) &&
        isStringArray(value.customizedContentTargetIds) &&
        typeof value.activePublicationTabId === 'string' &&
        (value.activeContentScopeId === undefined || typeof value.activeContentScopeId === 'string')
    )
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

/** Strip recovery metadata before writing the existing composer payload. */
export function recoveredComposerContent(
    state: PublicationRecoveryState
): PublicationComposerDraftContent {
    return {
        activeContentScopeId: state.activeContentScopeId,
        activePublicationTabId: state.activePublicationTabId,
        customizedContentTargetIds: state.customizedContentTargetIds,
        customizedTargetIds: state.customizedTargetIds,
        defaultDeliveryMode: state.defaultDeliveryMode,
        defaultScheduledAt: state.defaultScheduledAt,
        postContent: state.postContent,
        postTitle: state.postTitle,
        publicationTagIds: state.publicationTagIds,
        publicationTargets: state.publicationTargets,
        sourceMedia: state.sourceMedia,
    }
}

/** Compare persisted JSON meaning without depending on object-property insertion order. */
export function composerContentsEqual(left: unknown, right: unknown): boolean {
    function canonical(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
        if (value !== null && typeof value === 'object')
            return `{${Object.entries(value)
                .filter(([, item]) => item !== undefined)
                .sort(([first], [second]) => first.localeCompare(second))
                .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
                .join(',')}}`
        return JSON.stringify(value) ?? 'null'
    }
    return canonical(left) === canonical(right)
}
