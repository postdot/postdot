/** Browser-only targeted edits; the server remains the complete contract validator. */
export const requestOutcomeKeys = [
    'successStatuses',
    'retryableStatuses',
    'rejectedStatuses',
    'ambiguousStatuses',
] as const
export type RequestOutcomeKey = (typeof requestOutcomeKeys)[number]
export type RequestEdit =
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
    } else {
        if (!requestOutcomeKeys.includes(edit.outcome) || !record(request.response))
            return { ok: false, reason: 'unsupported' }
        const response = { ...request.response, [edit.outcome]: [...edit.value] }
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
