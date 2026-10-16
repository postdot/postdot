import { projectMappedRequest } from './channel-request-builder'

type RecordValue = Record<string, unknown>

export function projectQuery(profile: unknown) {
    const request = mappedRequest(profile)
    if (!request || (request.query !== undefined && !record(request.query))) return null
    return Object.entries(request.query ?? {}).map(([name, expression]) => ({
        name,
        value: fixedText(expression),
    }))
}

export function editQuery(
    profile: unknown,
    name: string,
    operation: 'add' | 'edit' | 'remove',
    value = ''
): RecordValue | null {
    const rows = projectQuery(profile)
    const request = mappedRequest(profile)
    if (!rows || !request || !record(profile) || !record(profile.execution)) return null
    const query = record(request.query) ? request.query : {}
    const exists = Object.hasOwn(query, name)
    if (operation === 'add') {
        if (exists || rows.length >= 64 || !validName(name)) return null
    } else if (!exists || fixedText(query[name]) === null) return null
    const next = { ...query }
    if (operation === 'remove') delete next[name]
    else
        Object.defineProperty(next, name, {
            value: {
                ...(exists && record(query[name]) ? query[name] : {}),
                kind: 'literal',
                value,
            },
            enumerable: true,
            configurable: true,
            writable: true,
        })
    return { ...profile, execution: { ...profile.execution, request: { ...request, query: next } } }
}

export function compareQuery(before: unknown, after: unknown) {
    const left = projectQuery(before)
    const right = projectQuery(after)
    if (!left || !right) return []
    return [...new Set([...left.map(row => row.name), ...right.map(row => row.name)])].flatMap(
        name => {
            const previous = left.find(row => row.name === name)?.value
            const next = right.find(row => row.name === name)?.value
            return previous === null || next === null || previous === next
                ? []
                : [{ name, before: previous, after: next }]
        }
    )
}

function mappedRequest(profile: unknown): RecordValue | null {
    return projectMappedRequest(profile) &&
        record(profile) &&
        record(profile.execution) &&
        record(profile.execution.request)
        ? profile.execution.request
        : null
}
function fixedText(expression: unknown): string | null {
    return record(expression) &&
        expression.kind === 'literal' &&
        typeof expression.value === 'string'
        ? expression.value
        : null
}
function validName(name: string) {
    return (
        name.length > 0 &&
        name.length <= 128 &&
        name === name.trim() &&
        !name.includes('\r') &&
        !name.includes('\n') &&
        !name.includes('\u0000')
    )
}
function record(value: unknown): value is RecordValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
