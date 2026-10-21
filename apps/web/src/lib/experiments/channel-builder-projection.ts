/** Isolated feasibility prototype. Not imported by Studio or a runtime package. */
import { ChannelProfileCompiler, type ChannelProfileDefinition } from '@postdot/core'

type RecordValue = Record<string, unknown>

export interface TextRuleEdit {
    readonly bindingId: string
    readonly required?: boolean
    readonly maxLength?: number
}

export type ProjectionResult =
    | { readonly ok: true; readonly profile: ChannelProfileDefinition }
    | { readonly ok: false; readonly reason: string }

const rootKeys = new Set([
    '$schema',
    'type',
    'properties',
    'required',
    'additionalProperties',
    'title',
    'description',
    '$comment',
])
const textKeys = new Set(['type', 'minLength', 'maxLength', 'title', 'description', '$comment'])

function record(value: unknown): value is RecordValue {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(reason: string): ProjectionResult {
    return { ok: false, reason }
}

/**
 * Patch the original, never reconstruct it from the form's supported subset.
 * The strict whitelist is intentional: preservation alone cannot prove that an
 * unknown rule does not constrain the field the operator is trying to change.
 */
export function editProfileTextRule(
    original: ChannelProfileDefinition,
    edit: TextRuleEdit
): ProjectionResult {
    if (original.origin !== 'custom' || original.execution.kind === 'built_in') {
        return fail('Provider-owned content rules are not editable.')
    }
    if (!new ChannelProfileCompiler().compile(original).ok) {
        return fail('The original profile does not pass the existing compiler.')
    }
    if (edit.required === undefined && edit.maxLength === undefined) {
        return { ok: true, profile: structuredClone(original) }
    }
    const root = original.contentSchema
    if (
        !record(root) ||
        root.type !== 'object' ||
        Object.keys(root).some(key => !rootKeys.has(key)) ||
        !record(root.properties)
    ) {
        return fail('The root schema has rules this prototype cannot safely edit.')
    }
    const bindings = original.fieldBindings.filter(binding => binding.id === edit.bindingId)
    const binding = bindings[0]
    if (
        bindings.length !== 1 ||
        binding === undefined ||
        !['primary_text', 'headline'].includes(binding.semantic) ||
        !/^\/[^/~]+$/.test(binding.path) ||
        original.fieldBindings.filter(candidate => candidate.path === binding.path).length !== 1
    ) {
        return fail('The field needs a unique, direct title or message binding.')
    }
    const property = binding.path.slice(1)
    const field = root.properties[property]
    const capabilities = original.capabilities.textFields.filter(
        candidate => candidate.bindingId === binding.id
    )
    const capability = capabilities[0]
    if (
        !record(field) ||
        field.type !== 'string' ||
        Object.keys(field).some(key => !textKeys.has(key)) ||
        capabilities.length !== 1 ||
        capability === undefined ||
        field.maxLength !== capability.maxLength
    ) {
        return fail('The field has unsupported or inconsistent schema and capability rules.')
    }
    if (
        original.capabilities.relations.some(
            relation =>
                relation.bindingId === binding.id || relation.relatedBindingId === binding.id
        )
    ) {
        return fail('This field participates in a relation that needs explicit editing support.')
    }
    if (
        edit.maxLength !== undefined &&
        (!Number.isSafeInteger(edit.maxLength) ||
            edit.maxLength < 1 ||
            edit.maxLength < Math.max(Number(field.minLength ?? 0), capability.minLength ?? 0))
    ) {
        return fail('The maximum must be a positive integer at least as large as the minimum.')
    }

    const profile = structuredClone(original)
    const schema = profile.contentSchema as RecordValue
    const properties = schema.properties as RecordValue
    const target = properties[property] as RecordValue
    if (edit.maxLength !== undefined) {
        target.maxLength = edit.maxLength
        // Preserve formats, weighted length and grapheme limits independently.
        const index = profile.capabilities.textFields.findIndex(
            item => item.bindingId === binding.id
        )
        Object.assign(profile, {
            capabilities: {
                ...profile.capabilities,
                textFields: profile.capabilities.textFields.map((item, position) =>
                    position === index ? { ...item, maxLength: edit.maxLength as number } : item
                ),
            },
        })
    }
    if (edit.required !== undefined) {
        const required = Array.isArray(schema.required) ? [...schema.required] : []
        const wasRequired = required.includes(property)
        if (edit.required && !wasRequired) required.push(property)
        if (!edit.required && wasRequired) required.splice(required.indexOf(property), 1)
        if (wasRequired !== edit.required) {
            if (required.length > 0) schema.required = required
            else delete schema.required
        }
    }
    if (!new ChannelProfileCompiler().compile(profile).ok) {
        return fail('The edited definition does not pass the existing compiler.')
    }
    // Identity and hashes are deliberately untouched: only the draft-save API
    // owns persisted revision metadata. This result is never activated here.
    return { ok: true, profile }
}
