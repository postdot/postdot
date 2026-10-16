/** Browser-only projection. The API remains authoritative for profile validation. */
type ObjectValue = Record<string, unknown>
export type BuilderReason = 'provider' | 'complex' | 'relation' | 'mismatch'
export interface BuilderField {
    readonly id: string
    readonly key: string
    readonly semantic: string
    readonly kind: 'text' | 'media'
    readonly required: boolean
    readonly maximum: number
    readonly minimum: number
    readonly reason?: BuilderReason
    readonly formats: readonly string[]
    readonly families: readonly string[]
    readonly maxBytes?: number
    readonly maxGraphemes?: number
    readonly maxWeightedLength?: number
    readonly familiesEditable: boolean
}
export interface BuilderEdit {
    readonly required?: boolean
    readonly maximum?: number
    readonly formats?: readonly string[]
    readonly families?: readonly string[]
    readonly maxBytes?: number | null
}
export type BuilderResult =
    | { readonly ok: true; readonly profile: ObjectValue }
    | { readonly ok: false; readonly reason: BuilderReason | 'bounds' }
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
const mediaKeys = new Set([
    'type',
    'items',
    'minItems',
    'maxItems',
    'title',
    'description',
    '$comment',
])
const familyTypes: Record<string, string> = {
    image: 'image/*',
    video: 'video/*',
    audio: 'audio/*',
    document: 'application/*',
}
export function builderRecord(value: unknown): value is ObjectValue {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function objects(value: unknown): ObjectValue[] {
    return Array.isArray(value) ? value.filter(builderRecord) : []
}
function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
}
function integer(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function hasReference(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasReference)
    if (!builderRecord(value)) return false
    return Object.hasOwn(value, '$ref') || Object.values(value).some(hasReference)
}
export function projectBuilderFields(profile: unknown): readonly BuilderField[] {
    if (!builderRecord(profile)) return []
    const schema = builderRecord(profile.contentSchema) ? profile.contentSchema : {}
    const properties = builderRecord(schema.properties) ? schema.properties : {}
    const capabilities = builderRecord(profile.capabilities) ? profile.capabilities : {}
    const bindings = objects(profile.fieldBindings)
    return bindings.flatMap(binding => {
        const media = binding.semantic === 'ordered_media'
        if (
            typeof binding.id !== 'string' ||
            typeof binding.path !== 'string' ||
            (!media && !['primary_text', 'headline', 'language'].includes(String(binding.semantic)))
        )
            return []
        const key = binding.path.slice(1)
        const field = builderRecord(properties[key]) ? properties[key] : {}
        const caps = objects(media ? capabilities.mediaFields : capabilities.textFields).filter(
            item => item.bindingId === binding.id
        )
        const cap = caps[0] ?? {}
        const maximum = media ? cap.maxItems : cap.maxLength
        let reason: BuilderReason | undefined
        if (builderRecord(profile.execution) && profile.execution.kind === 'built_in')
            reason = 'provider'
        else if (
            hasReference(schema) ||
            schema.type !== 'object' ||
            Object.keys(schema).some(item => !rootKeys.has(item)) ||
            !/^\/[^/~]+$/.test(binding.path) ||
            field.type !== (media ? 'array' : 'string') ||
            Object.keys(field).some(item => !(media ? mediaKeys : textKeys).has(item))
        )
            reason = 'complex'
        else if (
            bindings.filter(item => item.path === binding.path || item.id === binding.id).length !==
                1 ||
            caps.length !== 1 ||
            !integer(maximum) ||
            (media ? field.maxItems : field.maxLength) !== maximum
        )
            reason = 'mismatch'
        else if (
            objects(capabilities.relations).some(
                item => item.bindingId === binding.id || item.relatedBindingId === binding.id
            )
        )
            reason = 'relation'
        if (!reason && media && objects(cap.familyConstraints).length > 0) reason = 'complex'
        const families = strings(cap.families)
        const mimeTypes = strings(cap.mimeTypes)
        return [
            {
                id: binding.id,
                key,
                semantic: String(binding.semantic),
                kind: media ? ('media' as const) : ('text' as const),
                required: strings(schema.required).includes(key),
                maximum: integer(maximum) ? maximum : 0,
                minimum: Math.max(
                    Number((media ? field.minItems : field.minLength) ?? 0),
                    Number((media ? cap.minItems : cap.minLength) ?? 0)
                ),
                reason,
                formats: strings(cap.acceptedSourceFormats),
                families,
                maxBytes: integer(cap.maxBytesPerItem) ? cap.maxBytesPerItem : undefined,
                maxGraphemes: integer(cap.maxGraphemes) ? cap.maxGraphemes : undefined,
                maxWeightedLength: integer(cap.maxWeightedLength)
                    ? cap.maxWeightedLength
                    : undefined,
                familiesEditable:
                    !cap.familyConstraints &&
                    families.length === mimeTypes.length &&
                    families.every(item => mimeTypes.includes(familyTypes[item] ?? '')),
            },
        ]
    })
}
export function editBuilderField(profile: unknown, id: string, edit: BuilderEdit): BuilderResult {
    const field = projectBuilderFields(profile).find(item => item.id === id)
    if (!field || !builderRecord(profile)) return { ok: false, reason: 'complex' }
    if (field.reason) return { ok: false, reason: field.reason }
    if (
        edit.maximum !== undefined &&
        (!integer(edit.maximum) ||
            edit.maximum < Math.max(field.minimum, field.kind === 'text' ? 1 : 0))
    )
        return { ok: false, reason: 'bounds' }
    if (
        edit.maxBytes !== undefined &&
        edit.maxBytes !== null &&
        (!integer(edit.maxBytes) || edit.maxBytes < 1)
    )
        return { ok: false, reason: 'bounds' }
    if (
        edit.formats &&
        (field.kind !== 'text' ||
            !edit.formats.length ||
            new Set(edit.formats).size !== edit.formats.length ||
            edit.formats.some(item => !['plain_text', 'markdown'].includes(item)))
    )
        return { ok: false, reason: 'bounds' }
    if (
        edit.families &&
        (field.kind !== 'media' ||
            !field.familiesEditable ||
            !edit.families.length ||
            new Set(edit.families).size !== edit.families.length ||
            edit.families.some(item => !Object.hasOwn(familyTypes, item)))
    )
        return { ok: false, reason: 'complex' }
    if (field.kind === 'text' && edit.maxBytes !== undefined)
        return { ok: false, reason: 'complex' }
    if (field.kind === 'media' && edit.formats !== undefined)
        return { ok: false, reason: 'complex' }
    const next = structuredClone(profile)
    const schema = next.contentSchema as ObjectValue
    const target = (schema.properties as ObjectValue)[field.key] as ObjectValue
    const capabilities = next.capabilities as ObjectValue
    const cap = objects(
        field.kind === 'media' ? capabilities.mediaFields : capabilities.textFields
    ).find(item => item.bindingId === id)!
    if (edit.maximum !== undefined) {
        target[field.kind === 'media' ? 'maxItems' : 'maxLength'] = edit.maximum
        cap[field.kind === 'media' ? 'maxItems' : 'maxLength'] = edit.maximum
    }
    if (edit.required !== undefined) {
        const required = strings(schema.required)
        if (edit.required && !required.includes(field.key)) required.push(field.key)
        else if (!edit.required && required.includes(field.key))
            required.splice(required.indexOf(field.key), 1)
        if (required.length) schema.required = required
        else delete schema.required
    }
    if (edit.formats) cap.acceptedSourceFormats = [...edit.formats]
    if (edit.families) {
        cap.families = [...edit.families]
        cap.mimeTypes = edit.families.map(item => familyTypes[item])
    }
    if (edit.maxBytes !== undefined) {
        if (edit.maxBytes === null) delete cap.maxBytesPerItem
        else cap.maxBytesPerItem = edit.maxBytes
    }
    return { ok: true, profile: next }
}

export const builderComparedRules = [
    'required',
    'maximum',
    'formats',
    'families',
    'maxBytes',
    'maxGraphemes',
    'maxWeightedLength',
] as const
export type BuilderComparedRule = (typeof builderComparedRules)[number]
export interface BuilderRuleChange {
    readonly field: BuilderField
    readonly rule: BuilderComparedRule
    readonly before: BuilderField[BuilderComparedRule]
    readonly after: BuilderField[BuilderComparedRule]
}
/** Only claims comparison coverage for the controls this form represents. */
export function compareBuilderRules(before: unknown, after: unknown): readonly BuilderRuleChange[] {
    const prior = projectBuilderFields(before)
    return projectBuilderFields(after).flatMap(field => {
        const old = prior.find(
            item =>
                item.id === field.id && item.semantic === field.semantic && item.key === field.key
        )
        if (!old) return []
        return builderComparedRules.flatMap(rule =>
            JSON.stringify(old[rule]) === JSON.stringify(field[rule])
                ? []
                : [{ field, rule, before: old[rule], after: field[rule] }]
        )
    })
}
