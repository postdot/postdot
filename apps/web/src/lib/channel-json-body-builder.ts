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
    return previous.flatMap(property => {
        const following = next.find(item => item.name === property.name)
        if (
            !property.expression ||
            !following?.expression ||
            JSON.stringify(property.expression) === JSON.stringify(following.expression)
        )
            return []
        return [{ name: property.name, before: property.expression, after: following.expression }]
    })
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
