import { projectMappedRequest } from './channel-request-builder'
import { getTargetEditorFields } from './target-editor'

type RecordValue = Record<string, unknown>
export type JsonBodyLeaf =
    | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
    | { readonly kind: 'content'; readonly pointer: string }
export type JsonBodyProperty = { readonly name: string; readonly expression: JsonBodyLeaf | null }

/** Only existing simple properties are editable; nested expressions remain opaque. */
export function projectJsonBody(profile: unknown): readonly JsonBodyProperty[] | null {
    const object = bodyObject(profile)
    if (!object || !record(object.properties)) return null
    return Object.entries(object.properties).map(([name, expression]) => ({
        name,
        expression: leaf(expression),
    }))
}

export function editJsonBodyProperty(
    profile: unknown,
    name: string,
    value: JsonBodyLeaf
): RecordValue | null {
    const object = bodyObject(profile)
    if (!object || !record(object.properties) || !Object.hasOwn(object.properties, name))
        return null
    const original = leaf(object.properties[name])
    if (!original || original.kind !== value.kind) return null
    if (value.kind === 'literal') {
        if (
            original.kind !== 'literal' ||
            typeof value.value !== typeof original.value ||
            (original.value === null) !== (value.value === null) ||
            (typeof value.value === 'number' && !Number.isFinite(value.value))
        )
            return null
    } else if (!getTargetEditorFields(profile).some(field => field.path === value.pointer))
        return null
    if (
        !record(profile) ||
        !record(profile.execution) ||
        !record(profile.execution.request) ||
        !record(profile.execution.request.body)
    )
        return null
    return {
        ...profile,
        execution: {
            ...profile.execution,
            request: {
                ...profile.execution.request,
                body: {
                    ...profile.execution.request.body,
                    value: {
                        ...object,
                        properties: {
                            ...object.properties,
                            [name]: { ...(object.properties[name] as RecordValue), ...value },
                        },
                    },
                },
            },
        },
    }
}

export function compareJsonBodyProperties(before: unknown, after: unknown) {
    const previous = projectJsonBody(before)
    const next = projectJsonBody(after)
    if (!previous || !next) return []
    return [
        ...new Set([...previous.map(item => item.name), ...next.map(item => item.name)]),
    ].flatMap(name => {
        const oldProperty = previous.find(item => item.name === name)
        const newProperty = next.find(item => item.name === name)
        if (oldProperty?.expression === null || newProperty?.expression === null) return []
        const oldValue = oldProperty?.expression
        const newValue = newProperty?.expression
        return JSON.stringify(oldValue) === JSON.stringify(newValue)
            ? []
            : [{ name, before: oldValue, after: newValue }]
    })
}

export function changeJsonBodyProperty(
    profile: unknown,
    name: string,
    operation: 'add' | 'remove' | 'replace',
    value?: JsonBodyLeaf
): RecordValue | null {
    const object = bodyObject(profile)
    if (!object || !record(object.properties)) return null
    const properties = object.properties
    const exists = Object.hasOwn(properties, name)
    if (operation === 'add') {
        if (exists || Object.keys(properties).length >= 64 || !validName(name)) return null
    } else if (!exists || !leaf(properties[name])) return null
    if (operation !== 'remove' && (!value || !validLeaf(profile, value))) return null
    const next = { ...properties }
    if (operation === 'remove') delete next[name]
    else {
        const old = exists && record(properties[name]) ? properties[name] : {}
        const expression: RecordValue = { ...old, ...value }
        if (value?.kind === 'content') delete expression.value
        else delete expression.pointer
        Object.defineProperty(next, name, {
            value: expression,
            enumerable: true,
            writable: true,
            configurable: true,
        })
    }
    if (
        !record(profile) ||
        !record(profile.execution) ||
        !record(profile.execution.request) ||
        !record(profile.execution.request.body)
    )
        return null
    return {
        ...profile,
        execution: {
            ...profile.execution,
            request: {
                ...profile.execution.request,
                body: { ...profile.execution.request.body, value: { ...object, properties: next } },
            },
        },
    }
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
function validLeaf(profile: unknown, value: JsonBodyLeaf) {
    return value.kind === 'content'
        ? getTargetEditorFields(profile).some(field => field.path === value.pointer)
        : leaf(value) !== null
}

function bodyObject(profile: unknown): RecordValue | null {
    if (
        !projectMappedRequest(profile) ||
        !record(profile) ||
        !record(profile.execution) ||
        !record(profile.execution.request)
    )
        return null
    const body = profile.execution.request.body
    return record(body) &&
        body.kind === 'json' &&
        record(body.value) &&
        body.value.kind === 'object'
        ? body.value
        : null
}
function leaf(value: unknown): JsonBodyLeaf | null {
    if (!record(value)) return null
    if (value.kind === 'content' && typeof value.pointer === 'string')
        return { kind: 'content', pointer: value.pointer }
    if (
        value.kind === 'literal' &&
        (value.value === null ||
            ['string', 'boolean'].includes(typeof value.value) ||
            (typeof value.value === 'number' && Number.isFinite(value.value)))
    )
        return { kind: 'literal', value: value.value as string | number | boolean | null }
    return null
}
function record(value: unknown): value is RecordValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
