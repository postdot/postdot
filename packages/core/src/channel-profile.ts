import type { TSchema } from 'typebox'
import Schema from 'typebox/schema'

import {
    type DeclarativeHttpExecutionContract,
    validateDeclarativeHttpExecution,
} from './channel-transport'
import {
    type JsonSchema,
    validateContentResourceLimits,
    validateCustomContentSchema,
} from './json-schema-policy'
import type { SourceTextFormat } from './source-content'
import {
    hasValidationErrors,
    type ContentValidationRule,
    type ValidationIssue,
    type ValidationResult,
    validationFailure,
    validationSuccess,
} from './validation'

export const channelProfileOrigins = ['built_in', 'custom'] as const
export const channelProfileVersionStates = ['draft', 'active', 'superseded', 'disabled'] as const
export const channelFieldSemantics = [
    'primary_text',
    'headline',
    'language',
    'tags',
    'ordered_media',
] as const
export const mediaFamilies = ['image', 'video', 'audio', 'document'] as const

export type ChannelProfileOrigin = (typeof channelProfileOrigins)[number]
export type ChannelProfileVersionState = (typeof channelProfileVersionStates)[number]
export type ChannelFieldSemantic = (typeof channelFieldSemantics)[number]
export type MediaFamily = (typeof mediaFamilies)[number]

export interface ScalarFieldBinding {
    readonly id: string
    readonly semantic: Exclude<ChannelFieldSemantic, 'ordered_media'>
    readonly path: string
}

export interface MediaItemBinding {
    readonly assetIdPath: string
    readonly accessibilityTextPath?: string
}

export interface MediaFieldBinding {
    readonly id: string
    readonly semantic: 'ordered_media'
    readonly path: string
    readonly item: MediaItemBinding
    readonly role?: string
}

export type ChannelFieldBinding = ScalarFieldBinding | MediaFieldBinding

export interface TextFieldCapability {
    readonly bindingId: string
    readonly acceptedSourceFormats: readonly SourceTextFormat[]
    readonly minLength?: number
    readonly maxLength: number
    readonly maxGraphemes?: number
    readonly maxWeightedLength?: number
    readonly weightedLengthAlgorithm?: string
}

export interface MediaDimensionCapability {
    readonly minWidth?: number
    readonly maxWidth?: number
    readonly minHeight?: number
    readonly maxHeight?: number
}

export interface MediaDurationCapability {
    readonly minMilliseconds?: number
    readonly maxMilliseconds?: number
}

export interface MediaFieldCapability {
    readonly bindingId: string
    readonly families: readonly MediaFamily[]
    readonly mimeTypes: readonly string[]
    readonly minItems?: number
    readonly maxItems: number
    readonly maxBytesPerItem?: number
    readonly maxTotalBytes?: number
    readonly dimensions?: MediaDimensionCapability
    readonly duration?: MediaDurationCapability
    readonly accessibilityTextRequired?: boolean
    readonly publicUrlRequired?: boolean
}

export type CapabilityRelationKind = 'conflicts_with' | 'requires'

export interface CapabilityRelation {
    readonly kind: CapabilityRelationKind
    readonly bindingId: string
    readonly relatedBindingId: string
}

export interface ChannelCapabilities {
    readonly revision: string
    readonly textFields: readonly TextFieldCapability[]
    readonly mediaFields: readonly MediaFieldCapability[]
    readonly relations: readonly CapabilityRelation[]
}

export type ChannelExecutionContract =
    | { readonly kind: 'manual' }
    | {
          readonly kind: 'built_in'
          readonly contractId: string
          readonly revision: string
      }
    | DeclarativeHttpExecutionContract

export interface ChannelProfileDefinition {
    readonly id: string
    readonly version: number
    readonly profileHash: string
    readonly schemaHash: string
    readonly origin: ChannelProfileOrigin
    readonly contentSchema: JsonSchema | TSchema
    readonly fieldBindings: readonly ChannelFieldBinding[]
    readonly capabilities: ChannelCapabilities
    readonly execution: ChannelExecutionContract
}

interface RuntimeSchemaValidator {
    IsAccelerated(): boolean
    Check(value: unknown): boolean
    Errors(value: unknown): readonly [boolean, readonly RuntimeSchemaError[]]
}

interface RuntimeSchemaError {
    readonly keyword: string
    readonly instancePath: string
    readonly message: string
}

interface CachedSchemaValidator {
    readonly canonicalSchema: string
    readonly validator: RuntimeSchemaValidator
}

export interface CompiledChannelProfile {
    readonly profile: ChannelProfileDefinition
    readonly accelerated: boolean
    validate(content: unknown): ValidationResult<Readonly<Record<string, unknown>>>
    validateWithRules(
        content: unknown,
        rules: readonly ContentValidationRule[]
    ): Promise<ValidationResult<Readonly<Record<string, unknown>>>>
}

/**
 * Provider-owned validation for rules that cannot be expressed as a JSON
 * Schema or a provider-neutral capability. Adapters are trusted runtime code;
 * persisted profiles never contain executable validation behavior.
 */
export interface ChannelProfileValidationAdapter {
    readonly contractId: string
    prepareProfile?(profile: ChannelProfileDefinition): ChannelProfileDefinition
    validate(
        profile: ChannelProfileDefinition,
        content: Readonly<Record<string, unknown>>
    ): readonly ValidationIssue[]
}

export interface ChannelProfileCompilerOptions {
    readonly validationAdapters?: readonly ChannelProfileValidationAdapter[]
}

function profileIssue(
    path: string,
    code: string,
    message: string,
    source: ValidationIssue['source'] = 'domain'
): ValidationIssue {
    return { path, code, message, severity: 'error', source }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonBlank(value: string): boolean {
    return value.trim().length > 0
}

function canonicalizeJson(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value)
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) throw new TypeError('Channel profiles must not contain cycles')
        seen.add(value)
    }
    if (Array.isArray(value)) {
        const serialized = `[${value.map(item => canonicalizeJson(item, seen)).join(',')}]`
        seen.delete(value)
        return serialized
    }
    if (isRecord(value)) {
        const serialized = `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key], seen)}`)
            .join(',')}}`
        seen.delete(value)
        return serialized
    }

    throw new TypeError('Channel profiles must contain only JSON values')
}

function freezeValue<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) freezeValue(child)
        Object.freeze(value)
    }

    return value
}

function snapshotProfile(profile: ChannelProfileDefinition): ChannelProfileDefinition {
    canonicalizeJson(profile)
    return freezeValue(structuredClone(profile))
}

function isJsonPointer(value: string, allowRoot = false): boolean {
    if (value === '') return allowRoot
    if (!value.startsWith('/')) return false

    return value
        .slice(1)
        .split('/')
        .every(segment => !/~(?:[^01]|$)/.test(segment))
}

function decodeJsonPointer(pointer: string): string[] {
    if (pointer === '') return []

    return pointer
        .slice(1)
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function resolveReference(root: JsonSchema, reference: unknown): JsonSchema | undefined {
    if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined

    let current: unknown = root
    for (const segment of decodeJsonPointer(reference.slice(1))) {
        if (!isRecord(current) || !(segment in current)) return undefined
        current = current[segment]
    }

    return isRecord(current) ? current : undefined
}

function expandSchemaCandidates(
    root: JsonSchema,
    schema: JsonSchema,
    seen: ReadonlySet<JsonSchema>
): JsonSchema[] {
    if (seen.has(schema)) return []

    const nextSeen = new Set(seen).add(schema)
    const candidates: JsonSchema[] = [schema]
    const referenced = resolveReference(root, schema.$ref)
    if (referenced !== undefined) {
        candidates.push(...expandSchemaCandidates(root, referenced, nextSeen))
    }

    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
        const branches = schema[keyword]
        if (!Array.isArray(branches)) continue

        for (const branch of branches) {
            if (isRecord(branch)) {
                candidates.push(...expandSchemaCandidates(root, branch, nextSeen))
            }
        }
    }

    return candidates
}

function schemasAtInstancePath(
    root: JsonSchema,
    pointer: string,
    start: readonly JsonSchema[] = [root]
): JsonSchema[] {
    let candidates = [...start]

    for (const segment of decodeJsonPointer(pointer)) {
        const next: JsonSchema[] = []

        for (const candidate of candidates.flatMap(schema =>
            expandSchemaCandidates(root, schema, new Set())
        )) {
            if (candidate.type === 'object' && isRecord(candidate.properties)) {
                const property = candidate.properties[segment]
                if (isRecord(property)) next.push(property)
            }
        }

        candidates = next
    }

    return candidates.flatMap(schema => expandSchemaCandidates(root, schema, new Set()))
}

function mediaItemSchemas(root: JsonSchema, bindingPath: string): JsonSchema[] {
    return schemasAtInstancePath(root, bindingPath)
        .filter(schema => schema.type === 'array')
        .flatMap(schema => (isRecord(schema.items) ? [schema.items] : []))
}

function validateFieldBindings(profile: ChannelProfileDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const ids = new Set<string>()
    const semanticPaths = new Set<string>()
    if (!isRecord(profile.contentSchema)) return issues

    const contentSchema = profile.contentSchema

    for (const [index, binding] of profile.fieldBindings.entries()) {
        const basePath = `/fieldBindings/${index}`

        if (!isNonBlank(binding.id)) {
            issues.push(
                profileIssue(`${basePath}/id`, 'binding.id_blank', 'Binding ID must not be blank')
            )
        } else if (ids.has(binding.id)) {
            issues.push(
                profileIssue(
                    `${basePath}/id`,
                    'binding.id_duplicate',
                    `Binding ID ${binding.id} is duplicated`
                )
            )
        }
        ids.add(binding.id)

        if (!isJsonPointer(binding.path)) {
            issues.push(
                profileIssue(
                    `${basePath}/path`,
                    'binding.path_invalid',
                    'Binding path must be a non-root JSON Pointer',
                    'field_binding'
                )
            )
            continue
        }

        const semanticPath = `${binding.semantic}:${binding.path}`
        if (semanticPaths.has(semanticPath)) {
            issues.push(
                profileIssue(
                    `${basePath}/path`,
                    'binding.path_duplicate',
                    `Binding ${semanticPath} is duplicated`,
                    'field_binding'
                )
            )
        }
        semanticPaths.add(semanticPath)

        const boundSchemas = schemasAtInstancePath(contentSchema, binding.path)
        if (boundSchemas.length === 0) {
            issues.push(
                profileIssue(
                    `${basePath}/path`,
                    'binding.path_missing',
                    `Binding path ${binding.path} does not resolve in the content schema`,
                    'field_binding'
                )
            )
            continue
        }

        if (binding.semantic === 'ordered_media') {
            const itemSchemas = mediaItemSchemas(contentSchema, binding.path)
            if (itemSchemas.length === 0) {
                issues.push(
                    profileIssue(
                        `${basePath}/path`,
                        'binding.media_array_required',
                        'An ordered media binding must resolve to an array with object items',
                        'field_binding'
                    )
                )
                continue
            }

            for (const [key, pointer] of [
                ['assetIdPath', binding.item.assetIdPath],
                ['accessibilityTextPath', binding.item.accessibilityTextPath],
            ] as const) {
                if (pointer === undefined) continue

                if (!isJsonPointer(pointer)) {
                    issues.push(
                        profileIssue(
                            `${basePath}/item/${key}`,
                            'binding.path_invalid',
                            `${key} must be a non-root JSON Pointer relative to each media item`,
                            'field_binding'
                        )
                    )
                    continue
                }

                const resolved = schemasAtInstancePath(contentSchema, pointer, itemSchemas)
                if (resolved.length === 0) {
                    issues.push(
                        profileIssue(
                            `${basePath}/item/${key}`,
                            'binding.path_missing',
                            `${key} does not resolve within the media item schema`,
                            'field_binding'
                        )
                    )
                }
            }
        }
    }

    return issues
}

function invalidRange(minimum: number | undefined, maximum: number | undefined): boolean {
    return minimum !== undefined && maximum !== undefined && minimum > maximum
}

function invalidOptionalPositiveInteger(value: number | undefined): boolean {
    return value !== undefined && (!Number.isSafeInteger(value) || value < 0)
}

function validateCapabilities(profile: ChannelProfileDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const bindingIds = new Set(profile.fieldBindings.map(binding => binding.id))
    const capabilityBindings = new Set<string>()

    if (!isNonBlank(profile.capabilities.revision)) {
        issues.push(
            profileIssue(
                '/capabilities/revision',
                'capability.revision_blank',
                'Capability revision must not be blank',
                'capability'
            )
        )
    }

    for (const [index, capability] of profile.capabilities.textFields.entries()) {
        const path = `/capabilities/textFields/${index}`
        capabilityBindings.add(capability.bindingId)

        if (!bindingIds.has(capability.bindingId)) {
            issues.push(
                profileIssue(
                    `${path}/bindingId`,
                    'capability.binding_missing',
                    `Unknown binding ID ${capability.bindingId}`,
                    'capability'
                )
            )
        }
        if (!Number.isSafeInteger(capability.maxLength) || capability.maxLength < 0) {
            issues.push(
                profileIssue(
                    `${path}/maxLength`,
                    'capability.limit_invalid',
                    'Text maxLength must be a non-negative safe integer',
                    'capability'
                )
            )
        }
        if (invalidOptionalPositiveInteger(capability.maxGraphemes)) {
            issues.push(
                profileIssue(
                    `${path}/maxGraphemes`,
                    'capability.limit_invalid',
                    'Text maxGraphemes must be a non-negative safe integer',
                    'capability'
                )
            )
        }
        if (
            capability.maxWeightedLength !== undefined &&
            (!Number.isSafeInteger(capability.maxWeightedLength) ||
                capability.maxWeightedLength < 1)
        ) {
            issues.push(
                profileIssue(
                    `${path}/maxWeightedLength`,
                    'capability.limit_invalid',
                    'Text maxWeightedLength must be a positive safe integer',
                    'capability'
                )
            )
        }
        if (
            capability.weightedLengthAlgorithm !== undefined &&
            capability.weightedLengthAlgorithm.trim().length === 0
        ) {
            issues.push(
                profileIssue(
                    `${path}/weightedLengthAlgorithm`,
                    'capability.weighted_algorithm_invalid',
                    'Text weightedLengthAlgorithm must be a non-empty identifier',
                    'capability'
                )
            )
        }
        if (
            capability.maxWeightedLength !== undefined &&
            capability.weightedLengthAlgorithm === undefined
        ) {
            issues.push(
                profileIssue(
                    `${path}/weightedLengthAlgorithm`,
                    'capability.weighted_algorithm_required',
                    'Text maxWeightedLength requires a weightedLengthAlgorithm identifier',
                    'capability'
                )
            )
        }
        if (
            invalidOptionalPositiveInteger(capability.minLength) ||
            invalidRange(capability.minLength, capability.maxLength)
        ) {
            issues.push(
                profileIssue(
                    path,
                    'capability.range_invalid',
                    'Text minLength cannot exceed maxLength',
                    'capability'
                )
            )
        }
        if (
            capability.acceptedSourceFormats.length === 0 ||
            new Set(capability.acceptedSourceFormats).size !==
                capability.acceptedSourceFormats.length
        ) {
            issues.push(
                profileIssue(
                    `${path}/acceptedSourceFormats`,
                    'capability.formats_invalid',
                    'Accepted source formats must be non-empty and unique',
                    'capability'
                )
            )
        }
    }

    for (const [index, capability] of profile.capabilities.mediaFields.entries()) {
        const path = `/capabilities/mediaFields/${index}`
        capabilityBindings.add(capability.bindingId)

        if (!bindingIds.has(capability.bindingId)) {
            issues.push(
                profileIssue(
                    `${path}/bindingId`,
                    'capability.binding_missing',
                    `Unknown binding ID ${capability.bindingId}`,
                    'capability'
                )
            )
        }
        if (capability.families.length === 0 || capability.mimeTypes.length === 0) {
            issues.push(
                profileIssue(
                    path,
                    'capability.media_types_required',
                    'Media capabilities require at least one family and MIME type',
                    'capability'
                )
            )
        }
        if (
            new Set(capability.families).size !== capability.families.length ||
            new Set(capability.mimeTypes).size !== capability.mimeTypes.length
        ) {
            issues.push(
                profileIssue(
                    path,
                    'capability.media_types_duplicate',
                    'Media families and MIME types must be unique',
                    'capability'
                )
            )
        }
        if (!Number.isSafeInteger(capability.maxItems) || capability.maxItems < 0) {
            issues.push(
                profileIssue(
                    `${path}/maxItems`,
                    'capability.limit_invalid',
                    'Media maxItems must be a non-negative safe integer',
                    'capability'
                )
            )
        }
        if (
            invalidOptionalPositiveInteger(capability.minItems) ||
            invalidRange(capability.minItems, capability.maxItems)
        ) {
            issues.push(
                profileIssue(
                    path,
                    'capability.range_invalid',
                    'Media minItems cannot exceed maxItems',
                    'capability'
                )
            )
        }

        const numericLimits = [
            capability.maxBytesPerItem,
            capability.maxTotalBytes,
            capability.dimensions?.minWidth,
            capability.dimensions?.maxWidth,
            capability.dimensions?.minHeight,
            capability.dimensions?.maxHeight,
            capability.duration?.minMilliseconds,
            capability.duration?.maxMilliseconds,
        ]
        if (numericLimits.some(limit => invalidOptionalPositiveInteger(limit))) {
            issues.push(
                profileIssue(
                    path,
                    'capability.limit_invalid',
                    'Media numeric limits must be non-negative safe integers',
                    'capability'
                )
            )
        }
        if (
            invalidRange(capability.dimensions?.minWidth, capability.dimensions?.maxWidth) ||
            invalidRange(capability.dimensions?.minHeight, capability.dimensions?.maxHeight) ||
            invalidRange(capability.duration?.minMilliseconds, capability.duration?.maxMilliseconds)
        ) {
            issues.push(
                profileIssue(
                    path,
                    'capability.range_invalid',
                    'Media minimum limits cannot exceed their maximum limits',
                    'capability'
                )
            )
        }
    }

    if (
        capabilityBindings.size !==
        profile.capabilities.textFields.length + profile.capabilities.mediaFields.length
    ) {
        issues.push(
            profileIssue(
                '/capabilities',
                'capability.binding_duplicate',
                'Each binding may have at most one field capability',
                'capability'
            )
        )
    }

    for (const [index, relation] of profile.capabilities.relations.entries()) {
        const path = `/capabilities/relations/${index}`
        if (!bindingIds.has(relation.bindingId) || !bindingIds.has(relation.relatedBindingId)) {
            issues.push(
                profileIssue(
                    path,
                    'capability.binding_missing',
                    'Capability relations must reference existing bindings',
                    'capability'
                )
            )
        }
        if (relation.bindingId === relation.relatedBindingId) {
            issues.push(
                profileIssue(
                    path,
                    'capability.self_relation',
                    'A capability cannot require or conflict with itself',
                    'capability'
                )
            )
        }
    }

    return issues
}

function validateProfileDefinition(profile: ChannelProfileDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    if (!isNonBlank(profile.id)) {
        issues.push(profileIssue('/id', 'profile.id_blank', 'Profile ID must not be blank'))
    }
    if (!Number.isSafeInteger(profile.version) || profile.version < 1) {
        issues.push(
            profileIssue(
                '/version',
                'profile.version_invalid',
                'Profile version must be a positive safe integer'
            )
        )
    }
    if (!isNonBlank(profile.schemaHash)) {
        issues.push(
            profileIssue(
                '/schemaHash',
                'profile.schema_hash_blank',
                'Schema hash must not be blank'
            )
        )
    }
    if (!isNonBlank(profile.profileHash)) {
        issues.push(
            profileIssue(
                '/profileHash',
                'profile.hash_blank',
                'Complete profile hash must not be blank'
            )
        )
    }
    if (!isRecord(profile.contentSchema) || profile.contentSchema.type !== 'object') {
        issues.push(
            profileIssue(
                '/contentSchema/type',
                'profile.root_object_required',
                'Channel content must have an object schema'
            )
        )
    }
    if (profile.execution.kind !== 'manual') {
        if (!isNonBlank(profile.execution.contractId) || !isNonBlank(profile.execution.revision)) {
            issues.push(
                profileIssue(
                    '/execution',
                    'profile.execution_identity_required',
                    'Automatic execution contracts require non-blank identity and revision'
                )
            )
        }
    }
    if (profile.execution.kind === 'declarative_http') {
        issues.push(...validateDeclarativeHttpExecution(profile.execution))
    }

    if (profile.origin === 'custom') {
        const policy = validateCustomContentSchema(profile.contentSchema)
        if (!policy.ok) issues.push(...policy.issues)
    }

    issues.push(...validateFieldBindings(profile), ...validateCapabilities(profile))
    return issues
}

function schemaValidationIssues(
    validator: RuntimeSchemaValidator,
    content: unknown
): ValidationIssue[] {
    const [, errors] = validator.Errors(content)

    return errors.map(error => ({
        path: error.instancePath,
        code: `schema.${error.keyword}`,
        message: error.message,
        severity: 'error',
        source: 'schema',
    }))
}

function graphemeCount(value: string): number {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value))
        .length
}

function capabilityValidationIssues(
    profile: ChannelProfileDefinition,
    content: Readonly<Record<string, unknown>>
): ValidationIssue[] {
    const issues: ValidationIssue[] = []

    for (const capability of profile.capabilities.textFields) {
        if (capability.maxGraphemes === undefined) continue

        const binding = profile.fieldBindings.find(
            candidate =>
                candidate.id === capability.bindingId && candidate.semantic !== 'ordered_media'
        )
        if (binding === undefined) continue

        let value: unknown = content
        for (const segment of decodeJsonPointer(binding.path)) {
            if (!isRecord(value) || !(segment in value)) {
                value = undefined
                break
            }
            value = value[segment]
        }
        if (typeof value !== 'string') continue

        const count = graphemeCount(value)
        if (count > capability.maxGraphemes) {
            issues.push(
                profileIssue(
                    binding.path,
                    'content.grapheme_limit',
                    `Text must contain at most ${capability.maxGraphemes} graphemes`,
                    'capability'
                )
            )
        }
    }

    return issues
}

function createCompiledProfile(
    profile: ChannelProfileDefinition,
    validationProfile: ChannelProfileDefinition,
    validator: RuntimeSchemaValidator,
    validationAdapter?: ChannelProfileValidationAdapter
): CompiledChannelProfile {
    const validate = (content: unknown): ValidationResult<Readonly<Record<string, unknown>>> => {
        const resourceIssues = validateContentResourceLimits(content)
        if (hasValidationErrors(resourceIssues)) return validationFailure(resourceIssues)

        if (!validator.Check(content)) {
            return validationFailure(schemaValidationIssues(validator, content))
        }

        const capabilityIssues = capabilityValidationIssues(
            validationProfile,
            content as Readonly<Record<string, unknown>>
        )
        const providerIssues =
            validationAdapter?.validate(profile, content as Readonly<Record<string, unknown>>) ?? []
        const issues = [...capabilityIssues, ...providerIssues]
        if (hasValidationErrors(issues)) return validationFailure(issues)

        return validationSuccess(content as Readonly<Record<string, unknown>>, issues)
    }

    return {
        profile,
        accelerated: validator.IsAccelerated(),
        validate,
        async validateWithRules(content, rules) {
            const structural = validate(content)
            if (!structural.ok) return structural

            const ruleIssues = (await Promise.all(rules.map(rule => rule(structural.value)))).flat()

            return hasValidationErrors(ruleIssues)
                ? validationFailure(ruleIssues)
                : validationSuccess(structural.value, ruleIssues)
        },
    }
}

export class ChannelProfileCompiler {
    readonly #validators = new Map<string, CachedSchemaValidator>()
    readonly #validationAdapters = new Map<string, ChannelProfileValidationAdapter>()

    constructor(options: ChannelProfileCompilerOptions = {}) {
        for (const adapter of options.validationAdapters ?? []) {
            if (this.#validationAdapters.has(adapter.contractId)) {
                throw new TypeError(
                    `Duplicate channel profile validation adapter for ${adapter.contractId}`
                )
            }
            this.#validationAdapters.set(adapter.contractId, adapter)
        }
    }

    compile(profile: ChannelProfileDefinition): ValidationResult<CompiledChannelProfile> {
        let snapshot: ChannelProfileDefinition

        try {
            snapshot = snapshotProfile(profile)
        } catch (error) {
            return validationFailure([
                profileIssue(
                    '',
                    'profile.invalid_json_value',
                    error instanceof Error ? error.message : 'Channel profile is not valid JSON'
                ),
            ])
        }

        const definitionIssues = validateProfileDefinition(snapshot)
        if (hasValidationErrors(definitionIssues)) return validationFailure(definitionIssues)

        const contractId =
            snapshot.execution.kind === 'built_in' ? snapshot.execution.contractId : null
        const validationAdapter =
            contractId === null ? undefined : this.#validationAdapters.get(contractId)
        let validationProfile: ChannelProfileDefinition
        try {
            validationProfile =
                validationAdapter?.prepareProfile === undefined
                    ? snapshot
                    : snapshotProfile(validationAdapter.prepareProfile(structuredClone(snapshot)))
        } catch (error) {
            return validationFailure([
                profileIssue(
                    '/contentSchema',
                    'profile.validation_adapter_failed',
                    error instanceof Error
                        ? error.message
                        : 'Provider profile validation preparation failed',
                    'module'
                ),
            ])
        }

        const preparedDefinitionIssues = validateProfileDefinition(validationProfile)
        if (hasValidationErrors(preparedDefinitionIssues)) {
            return validationFailure(preparedDefinitionIssues)
        }

        const canonicalSchema = canonicalizeJson(validationProfile.contentSchema)

        const cacheKey = `${snapshot.id}:${snapshot.version}:${snapshot.schemaHash}:${contractId ?? ''}`
        const cached = this.#validators.get(cacheKey)
        if (cached !== undefined && cached.canonicalSchema !== canonicalSchema) {
            return validationFailure([
                profileIssue(
                    '/schemaHash',
                    'profile.schema_hash_conflict',
                    'The same immutable profile identity and schema hash resolved to different schemas'
                ),
            ])
        }

        let validator = cached?.validator

        if (validator === undefined) {
            try {
                validator = Schema.Compile(
                    validationProfile.contentSchema
                ) as RuntimeSchemaValidator
            } catch (error) {
                return validationFailure([
                    profileIssue(
                        '/contentSchema',
                        'profile.schema_compile_failed',
                        error instanceof Error
                            ? error.message
                            : 'Content schema compilation failed',
                        'schema_policy'
                    ),
                ])
            }
            this.#validators.set(cacheKey, { canonicalSchema, validator })
        }

        return validationSuccess(
            createCompiledProfile(snapshot, validationProfile, validator, validationAdapter)
        )
    }

    clear(): void {
        this.#validators.clear()
    }

    get size(): number {
        return this.#validators.size
    }
}
