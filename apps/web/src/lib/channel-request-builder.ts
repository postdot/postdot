/** Browser-only targeted edits; the server remains the complete contract validator. */
export const requestOutcomeKeys = [
    'successStatuses',
    'retryableStatuses',
    'rejectedStatuses',
    'ambiguousStatuses',
] as const
export type RequestOutcomeKey = (typeof requestOutcomeKeys)[number]
export type RequestStatusGroups = Readonly<Record<RequestOutcomeKey, readonly number[]>>
export const requestExtractionKeys = ['externalIdPointer', 'externalUrlPointer'] as const
export type RequestExtractionKey = (typeof requestExtractionKeys)[number]
export type RequestEdit =
    | {
          readonly kind: 'extraction'
          readonly field: RequestExtractionKey
          readonly value: string | undefined
      }
    | { readonly kind: 'outcomes'; readonly value: RequestStatusGroups }
    | { readonly kind: 'method'; readonly value: 'POST' | 'PUT' | 'PATCH' }
    | { readonly kind: 'segment'; readonly index: number; readonly value: string }
    | {
          readonly kind: 'statuses'
          readonly outcome: RequestOutcomeKey
          readonly value: readonly number[]
      }

type RecordValue = Record<string, unknown>
export type RequestEditResult =
    | { readonly ok: true; readonly profile: RecordValue }
    | { readonly ok: false; readonly reason: 'unsupported' | 'dynamic' | 'invalid' | 'overlap' }

export function projectMappedRequest(profile: unknown) {
    if (!record(profile) || profile.origin !== 'custom' || !record(profile.execution)) return null
    const execution = profile.execution
    if (
        execution.kind !== 'declarative_http' ||
        execution.mode !== 'mapped_http' ||
        !record(execution.request)
    )
        return null
    const request = execution.request
    if (!['POST', 'PUT', 'PATCH'].includes(String(request.method)) || !Array.isArray(request.path))
        return null
    return {
        method: request.method as 'POST' | 'PUT' | 'PATCH',
        segments: request.path.map((value, index) => ({
            index,
            value,
            editable: typeof value === 'string',
        })),
        response: record(request.response) ? request.response : null,
        bodyKind:
            record(request.body) && typeof request.body.kind === 'string'
                ? request.body.kind
                : null,
    }
}

export function editMappedRequest(profile: unknown, edit: RequestEdit): RequestEditResult {
    const projected = projectMappedRequest(profile)
    if (
        !projected ||
        !record(profile) ||
        !record(profile.execution) ||
        !record(profile.execution.request)
    )
        return { ok: false, reason: 'unsupported' }
    const request = profile.execution.request
    let updated: RecordValue
    if (edit.kind === 'method') {
        if (!['POST', 'PUT', 'PATCH'].includes(edit.value)) return { ok: false, reason: 'invalid' }
        updated = { ...request, method: edit.value }
    } else if (edit.kind === 'segment') {
        if (
            !Number.isSafeInteger(edit.index) ||
            edit.index < 0 ||
            edit.index >= projected.segments.length
        )
            return { ok: false, reason: 'invalid' }
        if (!projected.segments[edit.index]?.editable) return { ok: false, reason: 'dynamic' }
        if (!validSegment(edit.value)) return { ok: false, reason: 'invalid' }
        const path = projected.segments.map(segment =>
            segment.index === edit.index ? edit.value : segment.value
        )
        updated = { ...request, path }
    } else if (edit.kind === 'extraction') {
        if (!requestExtractionKeys.includes(edit.field) || !record(request.response))
            return { ok: false, reason: 'unsupported' }
        if (
            edit.value !== undefined &&
            (!edit.value.startsWith('/') || /~(?:[^01]|$)/.test(edit.value))
        )
            return { ok: false, reason: 'invalid' }
        const response = { ...request.response }
        if (edit.value === undefined) delete response[edit.field]
        else response[edit.field] = edit.value
        updated = { ...request, response }
    } else {
        if (
            (edit.kind === 'statuses' && !requestOutcomeKeys.includes(edit.outcome)) ||
            !record(request.response)
        )
            return { ok: false, reason: 'unsupported' }
        const response =
            edit.kind === 'outcomes'
                ? {
                      ...request.response,
                      ...Object.fromEntries(
                          requestOutcomeKeys.map(key => [key, [...edit.value[key]]])
                      ),
                  }
                : { ...request.response, [edit.outcome]: [...edit.value] }
        const statuses = requestOutcomeKeys.map(key => response[key])
        if (!statuses.every(validStatuses)) return { ok: false, reason: 'invalid' }
        const flat = statuses.flat() as number[]
        if (new Set(flat).size !== flat.length) return { ok: false, reason: 'overlap' }
        updated = { ...request, response }
    }
    return {
        ok: true,
        profile: { ...profile, execution: { ...profile.execution, request: updated } },
    }
}

function validSegment(value: string) {
    return (
        value.length > 0 &&
        value.length <= 256 &&
        value !== '.' &&
        value !== '..' &&
        !/[/?#\\]/.test(value) &&
        !value.includes('\u0000')
    )
}
function validStatuses(value: unknown): value is number[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 64 &&
        value.every(status => Number.isSafeInteger(status) && status >= 100 && status <= 599)
    )
}
function record(value: unknown): value is RecordValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accept comma/space separated HTTP codes, not ranges or numeric coercion. */
export function parseRequestStatuses(value: string): number[] | null {
    const parts = value.trim().split(/[\s,]+/)
    if (parts.length > 64 || parts.some(part => !/^[1-5][0-9]{2}$/.test(part))) return null
    return parts.map(Number)
}

export interface MappedRequestChange {
    readonly key: 'method' | `segment-${number}` | RequestOutcomeKey | RequestExtractionKey
    readonly segmentIndex?: number
    readonly before: string | null
    readonly after: string | null
}

/** Compare only the editable controls; never serialize expressions or credentials. */
export function compareMappedRequests(
    before: unknown,
    after: unknown
): readonly MappedRequestChange[] {
    const left = projectMappedRequest(before)
    const right = projectMappedRequest(after)
    if (!left || !right) return []
    const changes: MappedRequestChange[] = []
    if (left.method !== right.method)
        changes.push({ key: 'method', before: left.method, after: right.method })
    for (const segment of left.segments) {
        const next = right.segments[segment.index]
        if (segment.editable && next?.editable && segment.value !== next.value) {
            changes.push({
                key: `segment-${segment.index}`,
                segmentIndex: segment.index,
                before: String(segment.value),
                after: String(next.value),
            })
        }
    }
    for (const key of requestOutcomeKeys) {
        const oldCodes = left.response?.[key]
        const newCodes = right.response?.[key]
        if (!validStatuses(oldCodes) || !validStatuses(newCodes)) continue
        const previous = [...new Set(oldCodes)].sort((a, b) => a - b).join(', ')
        const next = [...new Set(newCodes)].sort((a, b) => a - b).join(', ')
        if (previous !== next) changes.push({ key, before: previous, after: next })
    }
    for (const key of requestExtractionKeys) {
        const previous = left.response?.[key]
        const next = right.response?.[key]
        if (
            (previous === undefined || typeof previous === 'string') &&
            (next === undefined || typeof next === 'string') &&
            previous !== next
        ) {
            changes.push({ key, before: previous ?? null, after: next ?? null })
        }
    }
    return changes
}
