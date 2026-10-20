import { X_MAX_WEIGHTED_POST_LENGTH, X_TEXT_COUNTING_ALGORITHM } from '@postbot/x/text'

import { getNativeEditorProfile } from '@/lib/native-presentation'
import * as m from '@/paraglide/messages.js'
import type { Locale } from '@/paraglide/runtime.js'

import { telegramTextLimit } from './telegram-text-constraints'

/** Keep generic field controls when the profile does not declare native execution. */
export function getTargetEditorProfile(profile: unknown) {
    const execution = isRecord(profile) && isRecord(profile.execution) ? profile.execution : null
    if (execution?.kind !== 'built_in' || typeof execution.contractId !== 'string') return undefined
    const editorProfile = getNativeEditorProfile({
        kind: 'built_in',
        contractId: execution.contractId,
    })
    return editorProfile === 'plain' ? undefined : editorProfile
}

export type TargetEditorFieldKind =
    | 'mastodon-poll'
    | 'text'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'string-list'
    | 'media'
    | 'unsupported'
    | 'readonly'

export type TargetEditorPrimitive = string | number | boolean | null

export interface TargetEditorField {
    readonly bindingId: string
    readonly path: string
    readonly semantic: string
    readonly kind: TargetEditorFieldKind
    readonly label: string
    readonly description: string | null
    readonly required: boolean
    readonly enumValues: readonly TargetEditorPrimitive[]
    readonly minLength: number | null
    readonly maxLength: number | null
    readonly maxWeightedLength: number | null
    readonly weightedLengthAlgorithm: string | null
    readonly minItems: number | null
    readonly maxItems: number | null
    readonly minimum: number | null
    readonly textLengthUnit?: 'utf16'
    readonly maximum: number | null
    readonly multipleOf: number | null
    readonly acceptedSourceFormats: readonly string[]
    readonly schemaType: string | null
}

export const unsetTargetFieldValue = '__postbot_target_field_unset__'

interface TargetEditorBinding {
    readonly id: string
    readonly path: string
    readonly semantic: string
}

export function getTargetEditorFields(
    profile: unknown,
    locale?: Locale,
    target?: unknown
): readonly TargetEditorField[] {
    if (!isRecord(profile)) return []

    const schema = isRecord(profile.contentSchema) ? profile.contentSchema : null
    const capabilities = readCapabilities(profile)

    const bindings = (Array.isArray(profile.fieldBindings) ? profile.fieldBindings : []).flatMap(
        readBinding
    )
    const bindingByPath = new Map(bindings.map(binding => [binding.path, binding]))
    const mediaPaths = bindings
        .filter(binding => binding.semantic === 'ordered_media')
        .map(binding => binding.path)
    const fields: TargetEditorField[] = []
    const emittedBindingIds = new Set<string>()

    if (schema !== null) {
        collectSchemaFields(
            schema,
            '',
            0,
            schema,
            bindingByPath,
            mediaPaths,
            capabilities,
            emittedBindingIds,
            fields
        )
    }

    for (const binding of bindings) {
        if (emittedBindingIds.has(binding.id)) continue
        fields.push(createBoundField(schema, binding, capabilities))
        emittedBindingIds.add(binding.id)
    }

    const execution = isRecord(profile.execution) ? profile.execution : null
    if (
        execution?.kind === 'built_in' &&
        execution.contractId === 'mastodon' &&
        execution.revision === 'status-v3' &&
        schema !== null &&
        resolveSchemaAtPath(schema, '/poll') !== null
    ) {
        for (let index = fields.length - 1; index >= 0; index--)
            if (fields[index]!.path === '/poll' || fields[index]!.path.startsWith('/poll/'))
                fields.splice(index, 1)
        fields.push({
            ...createField(
                schema,
                { id: 'schema:/poll', path: '/poll', semantic: 'provider_field' },
                capabilities
            ),
            kind: 'mastodon-poll',
            label: m.poll_title({}, { locale }),
        })
    }

    const telegramLimit = telegramTextLimit(profile, target)
    const nativeFields = fields.map(field =>
        telegramLimit !== null && field.semantic === 'primary_text' && field.kind === 'text'
            ? {
                  ...field,
                  maxLength: Math.min(field.maxLength ?? telegramLimit, telegramLimit),
                  textLengthUnit: 'utf16' as const,
              }
            : field
    )
    if (profile.origin !== 'built_in') return nativeFields
    return nativeFields.map(field => {
        const fieldSchema = schema === null ? null : resolveSchemaAtPath(schema, field.path)
        if (typeof fieldSchema?.title === 'string') return field
        const label = builtInFieldLabel(field.semantic, locale)
        return label === null ? field : { ...field, label }
    })
}

function builtInFieldLabel(semantic: string, locale?: Locale): string | null {
    const options = { locale }
    switch (semantic) {
        case 'primary_text':
            return m.profile_field_body({}, options)
        case 'headline':
            return m.profile_field_headline({}, options)
        case 'language':
            return m.profile_field_language({}, options)
        case 'ordered_media':
            return m.profile_field_media({}, options)
        default:
            return null
    }
}

function readBinding(value: unknown): TargetEditorBinding[] {
    if (!isRecord(value)) return []
    if (typeof value.id !== 'string' || typeof value.path !== 'string') return []
    if (typeof value.semantic !== 'string') return []
    return [{ id: value.id, path: value.path, semantic: value.semantic }]
}

function collectSchemaFields(
    root: JsonSchemaNode,
    path: string,
    depth: number,
    schema: JsonSchemaNode,
    bindingByPath: ReadonlyMap<string, TargetEditorBinding>,
    mediaPaths: readonly string[],
    capabilities: CapabilitySummary,
    emittedBindingIds: Set<string>,
    fields: TargetEditorField[]
): void {
    const resolved = resolveSchemaNode(root, schema)
    if (resolved === null || depth > 8 || !isRecord(resolved.properties)) return

    for (const [property, value] of Object.entries(resolved.properties)) {
        if (!isRecord(value)) continue
        const propertyPath = appendJsonPointer(path, property)
        const binding = bindingByPath.get(propertyPath)
        if (binding !== undefined) {
            fields.push(createBoundField(root, binding, capabilities))
            emittedBindingIds.add(binding.id)
            continue
        }

        if (mediaPaths.some(mediaPath => isPointerWithin(propertyPath, mediaPath))) continue

        const propertySchema = resolveSchemaAtPath(root, propertyPath)
        if (propertySchema !== null && schemaTypeOf(propertySchema) === 'object') {
            const before = fields.length
            collectSchemaFields(
                root,
                propertyPath,
                depth + 1,
                propertySchema,
                bindingByPath,
                mediaPaths,
                capabilities,
                emittedBindingIds,
                fields
            )
            if (fields.length !== before) continue
        }

        fields.push(
            createField(
                root,
                {
                    id: `schema:${propertyPath}`,
                    path: propertyPath,
                    semantic: 'provider_field',
                },
                capabilities
            )
        )
    }
}

function createBoundField(
    root: JsonSchemaNode | null,
    binding: TargetEditorBinding,
    capabilities: CapabilitySummary
): TargetEditorField {
    if (binding.semantic === 'ordered_media') {
        const schema = root === null ? null : resolveSchemaAtPath(root, binding.path)
        const capability = capabilities.media.get(binding.id)
        return {
            bindingId: binding.id,
            path: binding.path,
            semantic: binding.semantic,
            kind: 'media',
            label: schemaLabel(schema, binding.id),
            description: schemaDescription(schema),
            required: isRequiredPath(root, binding.path),
            enumValues: [],
            minLength: null,
            maxLength: null,
            maxWeightedLength: null,
            weightedLengthAlgorithm: null,
            minItems: greatestDefined(schema?.minItems, capability?.minItems),
            maxItems: leastDefined(schema?.maxItems, capability?.maxItems),
            minimum: null,
            maximum: null,
            multipleOf: null,
            acceptedSourceFormats: [],
            schemaType: 'array',
        }
    }

    return createField(root, binding, capabilities)
}

function createField(
    root: JsonSchemaNode | null,
    binding: TargetEditorBinding,
    capabilities: CapabilitySummary
): TargetEditorField {
    const schema = root === null ? null : resolveSchemaAtPath(root, binding.path)
    const capability = capabilities.text.get(binding.id)
    const enumValues = primitiveEnum(schema)
    const stringItemSchema =
        root !== null && schema !== null && isRecord(schema.items)
            ? resolveSchemaNode(root, schema.items)
            : null
    const kind = editorFieldKind(binding.semantic, schema, enumValues, stringItemSchema)
    const schemaType = schemaTypeOf(schema)
    const lengthSchema = kind === 'string-list' ? stringItemSchema : schema
    const maxWeightedLength = capability?.maxWeightedLength ?? null
    const weightedLengthAlgorithm = capability?.weightedLengthAlgorithm ?? null

    return {
        bindingId: binding.id,
        path: binding.path,
        semantic: binding.semantic,
        kind: schema?.readOnly === true ? 'readonly' : kind,
        label: schemaLabel(schema, lastPointerSegment(binding.path) ?? binding.id),
        description: schemaDescription(schema),
        required: isRequiredPath(root, binding.path),
        enumValues,
        minLength: greatestDefined(lengthSchema?.minLength, capability?.minLength),
        maxLength:
            maxWeightedLength === null
                ? leastDefined(lengthSchema?.maxLength, capability?.maxLength)
                : null,
        maxWeightedLength,
        weightedLengthAlgorithm,
        minItems: greatestDefined(schema?.minItems),
        maxItems: leastDefined(schema?.maxItems),
        minimum: finiteNumber(schema?.minimum),
        maximum: finiteNumber(schema?.maximum),
        multipleOf: finiteNumber(schema?.multipleOf),
        acceptedSourceFormats: capability?.acceptedSourceFormats ?? [],
        schemaType,
    }
}

export function readTargetField(target: Readonly<Record<string, unknown>>, path: string): unknown {
    if (path === '') return target
    if (!path.startsWith('/')) return undefined

    let current: unknown = target
    for (const segment of decodeJsonPointer(path)) {
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment)) return undefined
            current = current[Number(segment)]
        } else if (isRecord(current)) {
            current = current[segment]
        } else {
            return undefined
        }
    }
    return current
}

export function updateTargetField(
    target: Readonly<Record<string, unknown>>,
    path: string,
    value: unknown | undefined
): Record<string, unknown> {
    const next = structuredClone(target) as Record<string, unknown>
    if (!path.startsWith('/')) return next

    if (value === undefined) {
        deleteJsonPointer(next, path)
    } else {
        setJsonPointer(next, path, value)
    }
    return next
}

export function encodeTargetEnumValue(value: TargetEditorPrimitive): string {
    return JSON.stringify(value)
}

export function decodeTargetEnumValue(
    value: string,
    allowedValues: readonly TargetEditorPrimitive[]
): TargetEditorPrimitive | undefined {
    if (value === unsetTargetFieldValue) return undefined

    try {
        const parsed: unknown = JSON.parse(value)
        return allowedValues.some(candidate => Object.is(candidate, parsed))
            ? (parsed as TargetEditorPrimitive)
            : undefined
    } catch {
        return undefined
    }
}

interface CapabilitySummary {
    readonly text: Map<string, TextCapability>
    readonly media: Map<string, MediaCapability>
}

interface TextCapability {
    readonly minLength: number | undefined
    readonly maxLength: number | undefined
    readonly maxWeightedLength: number | undefined
    readonly weightedLengthAlgorithm: string | undefined
    readonly acceptedSourceFormats: readonly string[]
}

interface MediaCapability {
    readonly minItems: number | undefined
    readonly maxItems: number | undefined
}

interface JsonSchemaNode extends Record<string, unknown> {
    readonly type?: unknown
    readonly title?: unknown
    readonly description?: unknown
    readonly enum?: unknown
    readonly properties?: unknown
    readonly items?: unknown
    readonly $ref?: unknown
    readonly allOf?: unknown
    readonly anyOf?: unknown
    readonly oneOf?: unknown
    readonly readOnly?: unknown
    readonly minLength?: unknown
    readonly maxLength?: unknown
    readonly minItems?: unknown
    readonly maxItems?: unknown
    readonly minimum?: unknown
    readonly maximum?: unknown
    readonly multipleOf?: unknown
    readonly required?: unknown
}

function readCapabilities(profile: Record<string, unknown>): CapabilitySummary {
    const text = new Map<string, TextCapability>()
    const media = new Map<string, MediaCapability>()
    const capabilities = isRecord(profile.capabilities) ? profile.capabilities : null
    const execution = isRecord(profile.execution) ? profile.execution : null
    const legacyXProfile = execution?.kind === 'built_in' && execution.contractId === 'x'

    if (capabilities !== null && Array.isArray(capabilities.textFields)) {
        for (const value of capabilities.textFields) {
            if (!isRecord(value) || typeof value.bindingId !== 'string') continue
            text.set(value.bindingId, {
                minLength: numberOrUndefined(value.minLength),
                maxLength: numberOrUndefined(value.maxLength),
                maxWeightedLength:
                    numberOrUndefined(value.maxWeightedLength) ??
                    (legacyXProfile && value.bindingId === 'text'
                        ? X_MAX_WEIGHTED_POST_LENGTH
                        : undefined),
                weightedLengthAlgorithm:
                    stringOrUndefined(value.weightedLengthAlgorithm) ??
                    (legacyXProfile && value.bindingId === 'text'
                        ? X_TEXT_COUNTING_ALGORITHM
                        : undefined),
                acceptedSourceFormats: Array.isArray(value.acceptedSourceFormats)
                    ? value.acceptedSourceFormats.filter(
                          (format): format is string => typeof format === 'string'
                      )
                    : [],
            })
        }
    }

    if (capabilities !== null && Array.isArray(capabilities.mediaFields)) {
        for (const value of capabilities.mediaFields) {
            if (!isRecord(value) || typeof value.bindingId !== 'string') continue
            media.set(value.bindingId, {
                minItems: numberOrUndefined(value.minItems),
                maxItems: numberOrUndefined(value.maxItems),
            })
        }
    }

    return { text, media }
}

function editorFieldKind(
    semantic: string,
    schema: JsonSchemaNode | null,
    enumValues: readonly TargetEditorPrimitive[],
    stringItemSchema: JsonSchemaNode | null
): TargetEditorFieldKind {
    if (enumValues.length > 0) return 'enum'

    const type = schemaTypeOf(schema)
    if (type === 'string') return 'text'
    if (type === 'number' || type === 'integer') return 'number'
    if (type === 'boolean') return 'boolean'
    if (type === 'array' && isStringSchema(stringItemSchema)) return 'string-list'

    // The semantic is intentionally not used to guess a shape. A provider-owned
    // binding must be backed by its schema before the standard editor can touch it.
    void semantic
    return 'unsupported'
}

function primitiveEnum(schema: JsonSchemaNode | null): readonly TargetEditorPrimitive[] {
    if (schema === null || !Array.isArray(schema.enum)) return []
    return schema.enum.every(isTargetEditorPrimitive) ? schema.enum : []
}

function schemaTypeOf(schema: JsonSchemaNode | null): string | null {
    if (schema === null) return null
    if (typeof schema.type === 'string') return schema.type
    if (Array.isArray(schema.type)) {
        const types = schema.type.filter((value): value is string => typeof value === 'string')
        return types.length === 1 ? (types[0] ?? null) : null
    }
    const enumValues = primitiveEnum(schema)
    const enumTypes = new Set(enumValues.map(value => jsonTypeOf(value)))
    return enumTypes.size === 1 ? ([...enumTypes][0] ?? null) : null
}

function isStringSchema(schema: unknown): schema is JsonSchemaNode {
    return isRecord(schema) && schemaTypeOf(schema) === 'string'
}

function schemaLabel(schema: JsonSchemaNode | null, bindingId: string): string {
    return typeof schema?.title === 'string' && schema.title.trim() !== ''
        ? schema.title
        : humanize(bindingId)
}

function schemaDescription(schema: JsonSchemaNode | null): string | null {
    return typeof schema?.description === 'string' && schema.description.trim() !== ''
        ? schema.description
        : null
}

function humanize(value: string): string {
    const words = value
        .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[._-]+/u)
        .filter(Boolean)
    return words.map(word => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ')
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function greatestDefined(...values: (unknown | undefined)[]): number | null {
    const defined = values
        .map(value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined))
        .filter((value): value is number => value !== undefined)
    return defined.length === 0 ? null : Math.max(...defined)
}

function leastDefined(...values: (unknown | undefined)[]): number | null {
    const defined = values
        .map(value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined))
        .filter((value): value is number => value !== undefined)
    return defined.length === 0 ? null : Math.min(...defined)
}

function numberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function isTargetEditorPrimitive(value: unknown): value is TargetEditorPrimitive {
    return value === null || typeof value === 'string' || typeof value === 'boolean'
        ? true
        : typeof value === 'number' && Number.isFinite(value)
}

function jsonTypeOf(value: TargetEditorPrimitive): string {
    if (value === null) return 'null'
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
    return typeof value
}

function resolveSchemaAtPath(root: JsonSchemaNode, path: string): JsonSchemaNode | null {
    let current: JsonSchemaNode | null = resolveSchemaNode(root, root)
    if (current === null) return null

    for (const segment of decodeJsonPointer(path)) {
        if (current === null) return null
        const type = schemaTypeOf(current)
        if ((type === 'object' || isRecord(current.properties)) && isRecord(current.properties)) {
            const property: unknown = current.properties[segment]
            current = isRecord(property) ? resolveSchemaNode(root, property) : null
        } else if (type === 'array' && isRecord(current.items) && /^\d+$/.test(segment)) {
            current = resolveSchemaNode(root, current.items)
        } else {
            return null
        }
    }
    return current
}

function isRequiredPath(root: JsonSchemaNode | null, path: string): boolean {
    if (root === null || path === '' || !path.startsWith('/')) return false
    const segments = decodeJsonPointer(path)
    const property = segments.pop()
    if (property === undefined) return false
    const parent =
        segments.length === 0
            ? resolveSchemaNode(root, root)
            : resolveSchemaAtPath(root, `/${segments.map(encodeJsonPointerSegment).join('/')}`)
    return (
        parent !== null &&
        Array.isArray(parent.required) &&
        parent.required.some(value => value === property)
    )
}

function resolveSchemaNode(
    root: JsonSchemaNode,
    schema: JsonSchemaNode,
    seen: ReadonlySet<JsonSchemaNode> = new Set()
): JsonSchemaNode | null {
    if (seen.has(schema)) return null
    if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf) || Array.isArray(schema.allOf)) {
        return null
    }

    const referenced = resolveSchemaReference(root, schema.$ref)
    if (referenced === null) return schema

    return resolveSchemaNode(root, referenced, new Set(seen).add(schema))
}

function resolveSchemaReference(root: JsonSchemaNode, reference: unknown): JsonSchemaNode | null {
    if (typeof reference !== 'string' || !reference.startsWith('#/')) return null
    let current: unknown = root
    for (const segment of decodeJsonPointer(reference.slice(1))) {
        if (!isRecord(current) || !(segment in current)) return null
        current = current[segment]
    }
    return isRecord(current) ? current : null
}

function decodeJsonPointer(pointer: string): string[] {
    if (pointer === '') return []
    return pointer
        .slice(1)
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function encodeJsonPointerSegment(segment: string): string {
    return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function appendJsonPointer(pointer: string, segment: string): string {
    return `${pointer}/${encodeJsonPointerSegment(segment)}`
}

function lastPointerSegment(pointer: string): string | null {
    const segments = decodeJsonPointer(pointer)
    return segments.at(-1) ?? null
}

function isPointerWithin(pointer: string, ancestor: string): boolean {
    return pointer === ancestor || pointer.startsWith(`${ancestor}/`)
}

function setJsonPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
    const segments = decodeJsonPointer(pointer)
    let current: unknown = target

    for (const [index, segment] of segments.entries()) {
        const last = index === segments.length - 1
        if (Array.isArray(current)) {
            const arrayIndex = Number(segment)
            if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
            if (last) {
                current[arrayIndex] = value
                return
            }
            if (current[arrayIndex] === undefined || !isContainer(current[arrayIndex])) {
                current[arrayIndex] = nextContainer(segments[index + 1] ?? '')
            }
            current = current[arrayIndex]
            continue
        }

        if (!isRecord(current)) return
        if (last) {
            current[segment] = value
            return
        }
        if (!isContainer(current[segment]))
            current[segment] = nextContainer(segments[index + 1] ?? '')
        current = current[segment]
    }
}

function deleteJsonPointer(target: Record<string, unknown>, pointer: string): void {
    const segments = decodeJsonPointer(pointer)
    let current: unknown = target

    for (const [index, segment] of segments.entries()) {
        const last = index === segments.length - 1
        if (Array.isArray(current)) {
            const arrayIndex = Number(segment)
            if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
            if (last) {
                current.splice(arrayIndex, 1)
                return
            }
            current = current[arrayIndex]
            continue
        }
        if (!isRecord(current)) return
        if (last) {
            delete current[segment]
            return
        }
        current = current[segment]
    }
}

function nextContainer(nextSegment: string): Record<string, unknown> | unknown[] {
    return /^\d+$/.test(nextSegment) ? [] : {}
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
    return Array.isArray(value) || isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
