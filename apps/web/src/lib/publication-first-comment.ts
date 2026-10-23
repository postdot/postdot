/**
 * Studio rules for the prepared first comment of a native
 * publication. The public view belongs to the shared client contract; this
 * module owns only the deterministic Studio behaviour around it.
 */
import type { PublicationFirstCommentItem, PublicationFirstCommentResponse } from '@postdot/client'

import { providerRegistry } from '@/providers/registry'

export type { PublicationFirstCommentItem, PublicationFirstCommentResponse } from '@postdot/client'

/** The lifecycle of one prepared comment, taken from the shared contract. */
export type PublicationFirstCommentState = PublicationFirstCommentItem['state']

export const firstCommentMaxGraphemes = 300
export const firstCommentMaxTextLength = 3000
export const firstCommentMinDelaySeconds = 0
export const firstCommentMaxDelaySeconds = 604800

/** Product delay presets, in seconds after the confirmed parent publication. */
export const firstCommentDelayPresets = [0, 300, 1800, 3600, 86400, 604800] as const

export type FirstCommentDelayUnit = 'immediate' | 'seconds' | 'minutes' | 'hours' | 'days'

export interface FirstCommentDelayOption {
    readonly value: number
    readonly unit: FirstCommentDelayUnit
    readonly amount: number
}

export type FirstCommentTextProblem = 'empty' | 'too_long' | 'too_long_units'

const editableFirstCommentStates = new Set<PublicationFirstCommentState>([
    'waiting',
    'pending',
    'suspended',
])

const firstCommentDelayPresetSet = new Set<number>(firstCommentDelayPresets)

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Grapheme count, so a pasted emoji counts once like the provider counts it. */
export function countFirstCommentGraphemes(text: string): number {
    let count = 0
    for (const _segment of segmenter.segment(text)) count += 1
    return count
}

/**
 * The Bluesky envelope: a non-blank comment of at most 300 graphemes and at
 * most 3000 UTF-16 code units. The unit ceiling is reached by emoji sequences
 * that stay inside the grapheme limit.
 */
export function firstCommentTextProblem(
    text: string,
    providerId: string = 'bluesky',
    textLimit = providerRegistry.get(providerId)?.comments?.textLimit ?? 0
): FirstCommentTextProblem | null {
    if (text.trim().length === 0) return 'empty'
    const rules = providerRegistry.get(providerId)?.comments
    if (!rules) return 'too_long_units'
    if (rules.count(text) > textLimit)
        return rules.countUnit === 'utf16' ? 'too_long_units' : 'too_long'
    if (text.length > rules.maxLength) return 'too_long_units'
    return null
}

export function firstCommentDelayProblem(seconds: number): 'invalid' | 'out_of_range' | null {
    if (!Number.isSafeInteger(seconds)) return 'invalid'
    if (seconds < firstCommentMinDelaySeconds || seconds > firstCommentMaxDelaySeconds)
        return 'out_of_range'
    return null
}

/** Exact unit for a stored delay, so a preserved value never reads as a preset. */
export function describeFirstCommentDelay(seconds: number): FirstCommentDelayOption {
    if (seconds <= 0) return { value: 0, unit: 'immediate', amount: 0 }
    if (seconds % 86400 === 0) return { value: seconds, unit: 'days', amount: seconds / 86400 }
    if (seconds % 3600 === 0) return { value: seconds, unit: 'hours', amount: seconds / 3600 }
    if (seconds % 60 === 0) return { value: seconds, unit: 'minutes', amount: seconds / 60 }
    return { value: seconds, unit: 'seconds', amount: seconds }
}

/**
 * The presets plus the stored value when it is valid but not a preset, so a
 * persisted delay survives a round trip through the control.
 */
export function firstCommentDelayOptions(
    persistedSeconds: number | null
): readonly FirstCommentDelayOption[] {
    const options = firstCommentDelayPresets.map(describeFirstCommentDelay)
    if (
        persistedSeconds === null ||
        firstCommentDelayProblem(persistedSeconds) !== null ||
        firstCommentDelayPresetSet.has(persistedSeconds)
    )
        return options
    const stored = describeFirstCommentDelay(persistedSeconds)
    return [...options.filter(option => option.value !== stored.value), stored].sort(
        (left, right) => left.value - right.value
    )
}

function isFirstCommentEditableState(state: PublicationFirstCommentState): boolean {
    return editableFirstCommentStates.has(state)
}

/**
 * The form is offered when the publication can still be configured and the
 * session may write. An existing comment can be edited or re-enabled only
 * before it is claimed.
 */
export function firstCommentFormEditable(
    response: PublicationFirstCommentResponse,
    disabled: boolean
): boolean {
    if (disabled || !response.canConfigure) return false
    if (response.firstComment === null) return true
    return isFirstCommentEditableState(response.firstComment.state)
}

/** Cancelling unsent work is the destructive action, so it needs management. */
export function firstCommentCancellable(
    response: PublicationFirstCommentResponse,
    disabled: boolean
): boolean {
    if (disabled || !response.canManage) return false
    const item = response.firstComment
    return item !== null && isFirstCommentEditableState(item.state)
}

/** A published comment link stays on its known provider origin. */
export function firstCommentExternalLinkAllowed(
    url: string | null,
    providerId: string = 'bluesky',
    instanceOrigin: string | null = null
): url is string {
    return (
        url !== null &&
        providerRegistry.get(providerId)?.comments?.linkAllowed(url, instanceOrigin) === true
    )
}

/**
 * One server version of the first comment: the optimistic revision an
 * explicit save must present, together with the values that revision carried.
 */
export interface FirstCommentVersion {
    readonly revision: number
    readonly text: string
    readonly delaySeconds: number
}

/** The live server version, ready to be frozen as a baseline. */
export function firstCommentVersion(item: PublicationFirstCommentItem | null): FirstCommentVersion {
    return {
        revision: item?.revision ?? 0,
        text: item?.text ?? '',
        delaySeconds:
            item !== null && firstCommentDelayProblem(item.delaySeconds) === null
                ? item.delaySeconds
                : 0,
    }
}

export interface FirstCommentEditState {
    /**
     * The server version the local edits are based on. It is captured when
     * the first local edit starts and never moves on its own, so a background
     * refresh cannot silently rebase dirty input onto another editor's change.
     */
    readonly baseline: FirstCommentVersion | null
    /** The local text, or null while the form still shows the server text. */
    readonly draftText: string | null
    /** The local delay, or null while the form still shows the server delay. */
    readonly draftDelaySeconds: number | null
    /**
     * The server version that refused the last save. It is kept for the
     * operator to review, because a resubmit against a newer revision is only
     * intentional once that version has been shown.
     */
    readonly conflict: FirstCommentVersion | null
    /** Local edits since the panel opened, so a late response keeps newer input. */
    readonly editCount: number
}

export function firstCommentEditState(): FirstCommentEditState {
    return {
        baseline: null,
        draftText: null,
        draftDelaySeconds: null,
        conflict: null,
        editCount: 0,
    }
}

/**
 * Record a local edit. The first edit freezes the baseline, so the revision
 * an explicit save presents stays the one the operator started from.
 */
export function firstCommentEdited(
    state: FirstCommentEditState,
    live: FirstCommentVersion,
    patch: { readonly text?: string; readonly delaySeconds?: number }
): FirstCommentEditState {
    return {
        ...state,
        baseline: state.baseline ?? live,
        draftText: patch.text ?? state.draftText,
        draftDelaySeconds: patch.delaySeconds ?? state.draftDelaySeconds,
        editCount: state.editCount + 1,
    }
}

/**
 * Discard the local edits and review the current server version. The
 * operator asked for it, so the reviewed version becomes the new baseline.
 */
export function firstCommentReloaded(
    state: FirstCommentEditState,
    live: FirstCommentVersion
): FirstCommentEditState {
    return {
        baseline: live,
        draftText: null,
        draftDelaySeconds: null,
        conflict: null,
        editCount: state.editCount + 1,
    }
}

/**
 * Record the server version that refused the save. The local text and delay
 * stay untouched so the operator can compare them with that version.
 */
export function firstCommentConflicted(
    state: FirstCommentEditState,
    current: FirstCommentVersion
): FirstCommentEditState {
    return { ...state, conflict: current }
}

/**
 * The revision an explicit save presents. While a conflict is visible the
 * reviewed version is presented, so a resubmit is an intentional act against
 * a version the operator has seen.
 */
export function firstCommentSubmitRevision(
    state: FirstCommentEditState,
    live: FirstCommentVersion
): number {
    if (state.conflict !== null) return state.conflict.revision
    return state.baseline?.revision ?? live.revision
}

/**
 * Apply an accepted write. The local drafts are cleared only when no newer
 * edit arrived while the request was pending, so a late response cannot
 * discard input typed in the meantime.
 */
export function firstCommentAccepted(
    state: FirstCommentEditState,
    submittedEditCount: number,
    live: FirstCommentVersion
): FirstCommentEditState {
    const kept = state.editCount !== submittedEditCount
    return {
        baseline: live,
        draftText: kept ? state.draftText : null,
        draftDelaySeconds: kept ? state.draftDelaySeconds : null,
        conflict: null,
        editCount: state.editCount,
    }
}
