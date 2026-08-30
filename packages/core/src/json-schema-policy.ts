import Schema from 'typebox/schema'

import { jsonSchema202012MetaSchemas } from './json-schema-meta'
import type { ValidationIssue, ValidationResult } from './validation'
import { validationFailure, validationSuccess } from './validation'

export type JsonSchema = Readonly<Record<string, unknown>>

export const jsonSchema202012Dialect = 'https://json-schema.org/draft/2020-12/schema'

export const customSchemaLimits = {
    maxSchemaBytes: 64 * 1024,
    maxSchemaDepth: 16,
    maxSchemaNodes: 256,
    maxPropertiesPerObject: 64,
    maxDefinitions: 64,
    maxCompositionBranches: 16,
    maxEnumValues: 64,
    maxStringLength: 1_000_000,
    maxArrayItems: 10_000,
    maxInstanceBytes: 1024 * 1024,
    maxInstanceDepth: 64,
    maxInstanceNodes: 100_000,
    maxInstanceProperties: 1_024,
} as const

interface MetaSchemaError {
    readonly keyword: string
    readonly instancePath: string
    readonly message: string
}

interface MetaSchemaValidator {
    Check(value: unknown): boolean
    Errors(value: unknown): readonly [boolean, readonly MetaSchemaError[]]
}

let metaSchemaValidator: MetaSchemaValidator | undefined

function getMetaSchemaValidator(): MetaSchemaValidator {
    if (metaSchemaValidator !== undefined) return metaSchemaValidator

    const [root, ...references] = jsonSchema202012MetaSchemas
    const context = Object.fromEntries(references.map(schema => [schema.$id, schema]))
    metaSchemaValidator = Schema.Compile(context, root) as MetaSchemaValidator
    return metaSchemaValidator
}

const allowedKeywords = new Set([
    '$schema',
    '$ref',
    '$defs',
    '$comment',
    'title',
    'description',
    'default',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
    'contentEncoding',
    'contentMediaType',
    'type',
    'enum',
    'const',
    'properties',
    'required',
    'additionalProperties',
    'minProperties',
    'maxProperties',
    'dependentRequired',
    'dependentSchemas',
    'items',
    'prefixItems',
    'minItems',
    'maxItems',
    'uniqueItems',
    'contains',
    'minContains',
    'maxContains',
    'unevaluatedItems',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'unevaluatedProperties',
])

const forbiddenKeywords = new Set([
    '$id',
    '$anchor',
    '$dynamicAnchor',
    '$dynamicRef',
    '$recursiveAnchor',
    '$recursiveRef',
    '$vocabulary',
    'format',
    'pattern',
    'patternProperties',
    'propertyNames',
])

const scalarTypes = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'])
const annotationStringKeywords = [
    '$comment',
    'title',
    'description',
    'contentEncoding',
    'contentMediaType',
] as const
const annotationBooleanKeywords = ['deprecated', 'readOnly', 'writeOnly'] as const
const integerKeywords = [
    'minProperties',
    'maxProperties',
    'minItems',
    'maxItems',
    'minContains',
    'maxContains',
    'minLength',
    'maxLength',
] as const
const numberKeywords = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
] as const
const compositionKeywords = ['allOf', 'anyOf', 'oneOf'] as const
const directSchemaKeywords = ['items', 'contains', 'not', 'if', 'then', 'else'] as const

interface PolicyState {
    readonly root: JsonSchema
    readonly issues: ValidationIssue[]
    nodes: number
}

function escapePointerSegment(segment: string): string {
    return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path: string, segment: string | number): string {
    return `${path}/${escapePointerSegment(String(segment))}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function issue(state: PolicyState, path: string, code: string, message: string): void {
    state.issues.push({ path, code, message, severity: 'error', source: 'schema_policy' })
}

function validateJsonValue(
    value: unknown,
    state: PolicyState,
    path: string,
    seen: WeakSet<object>
): boolean {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return true
    }

    if (typeof value !== 'object') {
        issue(state, path, 'schema.invalid_json_value', 'Schema values must be valid JSON values')
        return false
    }

    if (seen.has(value)) {
        issue(state, path, 'schema.circular_value', 'Schema values must not contain cycles')
        return false
    }

    seen.add(value)
    let valid = true

    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            valid = validateJsonValue(item, state, childPath(path, index), seen) && valid
        }
    } else if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            valid = validateJsonValue(item, state, childPath(path, key), seen) && valid
        }
    } else {
        issue(
            state,
            path,
            'schema.invalid_json_object',
            'Schema objects must be plain JSON objects'
        )
        valid = false
    }

    seen.delete(value)
    return valid
}

function requireString(
    schema: Record<string, unknown>,
    keyword: string,
    state: PolicyState,
    path: string
): void {
    if (keyword in schema && typeof schema[keyword] !== 'string') {
        issue(state, childPath(path, keyword), 'schema.keyword_type', `${keyword} must be a string`)
    }
}

function requireBoolean(
    schema: Record<string, unknown>,
    keyword: string,
    state: PolicyState,
    path: string
): void {
    if (keyword in schema && typeof schema[keyword] !== 'boolean') {
        issue(
            state,
            childPath(path, keyword),
            'schema.keyword_type',
            `${keyword} must be a boolean`
        )
    }
}

function requireNonNegativeInteger(
    schema: Record<string, unknown>,
    keyword: string,
    state: PolicyState,
    path: string
): void {
    const value = schema[keyword]

    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
        issue(
            state,
            childPath(path, keyword),
            'schema.keyword_type',
            `${keyword} must be a non-negative safe integer`
        )
    }
}

function requireFiniteNumber(
    schema: Record<string, unknown>,
    keyword: string,
    state: PolicyState,
    path: string
): void {
    const value = schema[keyword]

    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
        issue(
            state,
            childPath(path, keyword),
            'schema.keyword_type',
            `${keyword} must be a finite number`
        )
    }
}

function validateRequired(
    schema: Record<string, unknown>,
    properties: Record<string, unknown> | undefined,
    state: PolicyState,
    path: string
): void {
    if (schema.required === undefined) return

    if (
        !Array.isArray(schema.required) ||
        schema.required.some(value => typeof value !== 'string')
    ) {
        issue(
            state,
            childPath(path, 'required'),
            'schema.keyword_type',
            'required must be an array of property names'
        )
        return
    }

    const required = schema.required as string[]
    if (new Set(required).size !== required.length) {
        issue(
            state,
            childPath(path, 'required'),
            'schema.required_duplicate',
            'required property names must be unique'
        )
    }

    for (const name of required) {
        if (properties === undefined || !(name in properties)) {
            issue(
                state,
                childPath(path, 'required'),
                'schema.required_unknown_property',
                `Required property ${name} must be declared in properties`
            )
        }
    }
}

function validateObjectSchema(
    schema: Record<string, unknown>,
    state: PolicyState,
    path: string,
    depth: number
): void {
    const properties = isRecord(schema.properties) ? schema.properties : undefined

    if (schema.properties !== undefined && properties === undefined) {
        issue(
            state,
            childPath(path, 'properties'),
            'schema.keyword_type',
            'properties must be an object of schemas'
        )
    }

    if (schema.type === 'object') {
        if (properties === undefined) {
            issue(
                state,
                path,
                'schema.explicit_properties_required',
                'Object schemas must declare explicit properties'
            )
        }
        if (schema.additionalProperties !== false) {
            issue(
                state,
                childPath(path, 'additionalProperties'),
                'schema.additional_properties_forbidden',
                'Object schemas must set additionalProperties to false'
            )
        }
    } else if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
        issue(
            state,
            childPath(path, 'additionalProperties'),
            'schema.additional_properties_forbidden',
            'additionalProperties can only be false in custom schemas'
        )
    }

    if (properties !== undefined) {
        const entries = Object.entries(properties)
        if (entries.length > customSchemaLimits.maxPropertiesPerObject) {
            issue(
                state,
                childPath(path, 'properties'),
                'schema.properties_limit',
                `Object schemas may declare at most ${customSchemaLimits.maxPropertiesPerObject} properties`
            )
        }

        for (const [name, propertySchema] of entries) {
            if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
                issue(
                    state,
                    childPath(childPath(path, 'properties'), name),
                    'schema.unsafe_property_name',
                    `Property name ${name} is not allowed`
                )
            }
            walkSchema(
                propertySchema,
                state,
                childPath(childPath(path, 'properties'), name),
                depth + 1
            )
        }
    }

    validateRequired(schema, properties, state, path)

    if (schema.maxProperties !== undefined) {
        const maxProperties = schema.maxProperties as number
        if (maxProperties > customSchemaLimits.maxPropertiesPerObject) {
            issue(
                state,
                childPath(path, 'maxProperties'),
                'schema.properties_limit',
                `maxProperties cannot exceed ${customSchemaLimits.maxPropertiesPerObject}`
            )
        }
    }

    if (
        typeof schema.minProperties === 'number' &&
        typeof schema.maxProperties === 'number' &&
        schema.minProperties > schema.maxProperties
    ) {
        issue(state, path, 'schema.invalid_range', 'minProperties cannot exceed maxProperties')
    }
}

function validateArraySchema(
    schema: Record<string, unknown>,
    state: PolicyState,
    path: string,
    depth: number
): void {
    if (schema.type === 'array') {
        if (!Number.isSafeInteger(schema.maxItems)) {
            issue(
                state,
                childPath(path, 'maxItems'),
                'schema.array_maximum_required',
                'Array schemas must declare a finite maxItems'
            )
        } else if ((schema.maxItems as number) > customSchemaLimits.maxArrayItems) {
            issue(
                state,
                childPath(path, 'maxItems'),
                'schema.array_limit',
                `maxItems cannot exceed ${customSchemaLimits.maxArrayItems}`
            )
        }

        if (schema.items === undefined && schema.prefixItems === undefined) {
            issue(
                state,
                path,
                'schema.array_items_required',
                'Array schemas must declare items or prefixItems'
            )
        }
    }

    if (schema.items !== undefined) {
        walkSchema(schema.items, state, childPath(path, 'items'), depth + 1)
    }

    if (schema.prefixItems !== undefined) {
        if (!Array.isArray(schema.prefixItems)) {
            issue(
                state,
                childPath(path, 'prefixItems'),
                'schema.keyword_type',
                'prefixItems must be an array of schemas'
            )
        } else {
            if (schema.prefixItems.length > customSchemaLimits.maxCompositionBranches) {
                issue(
                    state,
                    childPath(path, 'prefixItems'),
                    'schema.composition_limit',
                    `prefixItems may contain at most ${customSchemaLimits.maxCompositionBranches} schemas`
                )
            }
            schema.prefixItems.forEach((item, index) =>
                walkSchema(item, state, childPath(childPath(path, 'prefixItems'), index), depth + 1)
            )
        }
    }

    if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
        issue(
            state,
            childPath(path, 'uniqueItems'),
            'schema.keyword_type',
            'uniqueItems must be a boolean'
        )
    }

    if (
        typeof schema.minItems === 'number' &&
        typeof schema.maxItems === 'number' &&
        schema.minItems > schema.maxItems
    ) {
        issue(state, path, 'schema.invalid_range', 'minItems cannot exceed maxItems')
    }
}

function validateDefinitions(
    schema: Record<string, unknown>,
    state: PolicyState,
    path: string,
    depth: number
): void {
    if (schema.$defs === undefined) return

    if (!isRecord(schema.$defs)) {
        issue(
            state,
            childPath(path, '$defs'),
            'schema.keyword_type',
            '$defs must be an object of schemas'
        )
        return
    }

    const entries = Object.entries(schema.$defs)
    if (entries.length > customSchemaLimits.maxDefinitions) {
        issue(
            state,
            childPath(path, '$defs'),
            'schema.definitions_limit',
            `A schema may declare at most ${customSchemaLimits.maxDefinitions} definitions`
        )
    }

    entries.forEach(([name, definition]) =>
        walkSchema(definition, state, childPath(childPath(path, '$defs'), name), depth + 1)
    )
}

function resolveLocalReference(root: JsonSchema, reference: string): unknown {
    if (!reference.startsWith('#/$defs/')) return undefined

    let current: unknown = root
    const segments = reference
        .slice(2)
        .split('/')
        .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))

    for (const segment of segments) {
        if (!isRecord(current) || !(segment in current)) return undefined
        current = current[segment]
    }

    return current
}

function validateReference(
    schema: Record<string, unknown>,
    state: PolicyState,
    path: string
): void {
    if (schema.$ref === undefined) return

    if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/$defs/')) {
        issue(
            state,
            childPath(path, '$ref'),
            'schema.reference_forbidden',
            "References must target this profile's $defs"
        )
        return
    }

    if (!isRecord(resolveLocalReference(state.root, schema.$ref))) {
        issue(
            state,
            childPath(path, '$ref'),
            'schema.reference_missing',
            `Reference ${schema.$ref} does not resolve to a schema`
        )
    }
}

function validateDependentSchemas(
    schema: Record<string, unknown>,
    state: PolicyState,
    path: string,
    depth: number
): void {
    if (schema.dependentSchemas !== undefined) {
        if (!isRecord(schema.dependentSchemas)) {
            issue(
                state,
                childPath(path, 'dependentSchemas'),
                'schema.keyword_type',
                'dependentSchemas must be an object of schemas'
            )
        } else {
            Object.entries(schema.dependentSchemas).forEach(([name, dependentSchema]) =>
                walkSchema(
                    dependentSchema,
                    state,
                    childPath(childPath(path, 'dependentSchemas'), name),
                    depth + 1
                )
            )
        }
    }

    if (schema.dependentRequired !== undefined) {
        if (!isRecord(schema.dependentRequired)) {
            issue(
                state,
                childPath(path, 'dependentRequired'),
                'schema.keyword_type',
                'dependentRequired must be an object of property-name arrays'
            )
        } else {
            for (const [name, dependencies] of Object.entries(schema.dependentRequired)) {
                if (
                    !Array.isArray(dependencies) ||
                    dependencies.some(value => typeof value !== 'string')
                ) {
                    issue(
                        state,
                        childPath(childPath(path, 'dependentRequired'), name),
                        'schema.keyword_type',
                        'Dependent properties must be an array of property names'
                    )
                }
            }
        }
    }
}

function walkSchema(value: unknown, state: PolicyState, path: string, depth: number): void {
    if (!isRecord(value)) {
        issue(state, path, 'schema.object_required', 'Schema nodes must be JSON objects')
        return
    }

    state.nodes += 1
    if (state.nodes > customSchemaLimits.maxSchemaNodes) {
        if (state.nodes === customSchemaLimits.maxSchemaNodes + 1) {
            issue(
                state,
                path,
                'schema.node_limit',
                `Schemas may contain at most ${customSchemaLimits.maxSchemaNodes} nodes`
            )
        }
        return
    }

    if (depth > customSchemaLimits.maxSchemaDepth) {
        issue(
            state,
            path,
            'schema.depth_limit',
            `Schema depth cannot exceed ${customSchemaLimits.maxSchemaDepth}`
        )
        return
    }

    if (path !== '' && '$schema' in value) {
        issue(
            state,
            childPath(path, '$schema'),
            'schema.nested_dialect_forbidden',
            '$schema may only appear at the profile root'
        )
    }

    for (const keyword of Object.keys(value)) {
        if (forbiddenKeywords.has(keyword)) {
            issue(
                state,
                childPath(path, keyword),
                'schema.keyword_forbidden',
                `${keyword} is not available in custom channel schemas`
            )
        } else if (!allowedKeywords.has(keyword)) {
            issue(
                state,
                childPath(path, keyword),
                'schema.keyword_unknown',
                `Unknown JSON Schema keyword: ${keyword}`
            )
        }
    }

    if (
        value.type !== undefined &&
        (typeof value.type !== 'string' || !scalarTypes.has(value.type))
    ) {
        issue(
            state,
            childPath(path, 'type'),
            'schema.keyword_type',
            'type must be one supported JSON scalar type'
        )
    }

    for (const keyword of annotationStringKeywords) requireString(value, keyword, state, path)
    for (const keyword of annotationBooleanKeywords) requireBoolean(value, keyword, state, path)
    for (const keyword of integerKeywords) requireNonNegativeInteger(value, keyword, state, path)
    for (const keyword of numberKeywords) requireFiniteNumber(value, keyword, state, path)

    if (typeof value.multipleOf === 'number' && value.multipleOf <= 0) {
        issue(
            state,
            childPath(path, 'multipleOf'),
            'schema.invalid_multiple',
            'multipleOf must be greater than zero'
        )
    }

    if (value.enum !== undefined) {
        if (!Array.isArray(value.enum) || value.enum.length === 0) {
            issue(
                state,
                childPath(path, 'enum'),
                'schema.keyword_type',
                'enum must be a non-empty array'
            )
        } else if (value.enum.length > customSchemaLimits.maxEnumValues) {
            issue(
                state,
                childPath(path, 'enum'),
                'schema.enum_limit',
                `enum may contain at most ${customSchemaLimits.maxEnumValues} values`
            )
        }
    }

    if (value.examples !== undefined && !Array.isArray(value.examples)) {
        issue(
            state,
            childPath(path, 'examples'),
            'schema.keyword_type',
            'examples must be an array'
        )
    }

    for (const keyword of ['unevaluatedItems', 'unevaluatedProperties'] as const) {
        if (value[keyword] !== undefined && value[keyword] !== false) {
            issue(
                state,
                childPath(path, keyword),
                'schema.unevaluated_value_forbidden',
                `${keyword} can only be false in custom schemas`
            )
        }
    }

    if (value.type === 'string') {
        if (!Number.isSafeInteger(value.maxLength)) {
            issue(
                state,
                childPath(path, 'maxLength'),
                'schema.string_maximum_required',
                'String schemas must declare a finite maxLength'
            )
        } else if ((value.maxLength as number) > customSchemaLimits.maxStringLength) {
            issue(
                state,
                childPath(path, 'maxLength'),
                'schema.string_limit',
                `maxLength cannot exceed ${customSchemaLimits.maxStringLength}`
            )
        }
    }

    if (
        typeof value.minLength === 'number' &&
        typeof value.maxLength === 'number' &&
        value.minLength > value.maxLength
    ) {
        issue(state, path, 'schema.invalid_range', 'minLength cannot exceed maxLength')
    }

    validateObjectSchema(value, state, path, depth)
    validateArraySchema(value, state, path, depth)
    validateDefinitions(value, state, path, depth)
    validateReference(value, state, path)
    validateDependentSchemas(value, state, path, depth)

    for (const keyword of compositionKeywords) {
        const schemas = value[keyword]
        if (schemas === undefined) continue

        if (!Array.isArray(schemas) || schemas.length === 0) {
            issue(
                state,
                childPath(path, keyword),
                'schema.keyword_type',
                `${keyword} must be a non-empty array of schemas`
            )
            continue
        }

        if (schemas.length > customSchemaLimits.maxCompositionBranches) {
            issue(
                state,
                childPath(path, keyword),
                'schema.composition_limit',
                `${keyword} may contain at most ${customSchemaLimits.maxCompositionBranches} schemas`
            )
        }

        schemas.forEach((schema, index) =>
            walkSchema(schema, state, childPath(childPath(path, keyword), index), depth + 1)
        )
    }

    for (const keyword of directSchemaKeywords) {
        if (value[keyword] !== undefined && keyword !== 'items') {
            walkSchema(value[keyword], state, childPath(path, keyword), depth + 1)
        }
    }
}

export function validateCustomContentSchema(value: unknown): ValidationResult<JsonSchema> {
    const root = isRecord(value) ? value : {}
    const state: PolicyState = { root, issues: [], nodes: 0 }

    if (!isRecord(value)) {
        issue(state, '', 'schema.root_object_required', 'The content schema must be an object')
        return validationFailure(state.issues)
    }

    const validJson = validateJsonValue(value, state, '', new WeakSet())
    if (validJson) {
        const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
        if (bytes > customSchemaLimits.maxSchemaBytes) {
            issue(
                state,
                '',
                'schema.byte_limit',
                `Schema JSON cannot exceed ${customSchemaLimits.maxSchemaBytes} bytes`
            )
        } else {
            const validator = getMetaSchemaValidator()
            if (!validator.Check(value)) {
                const [, errors] = validator.Errors(value)
                state.issues.push(
                    ...errors.map(error => ({
                        path: error.instancePath,
                        code: `schema.meta.${error.keyword}`,
                        message: error.message,
                        severity: 'error' as const,
                        source: 'schema_policy' as const,
                    }))
                )
            }
        }
    }

    if (value.$schema !== jsonSchema202012Dialect) {
        issue(
            state,
            '/$schema',
            'schema.dialect_required',
            `Custom schemas must declare ${jsonSchema202012Dialect}`
        )
    }

    if (value.type !== 'object') {
        issue(
            state,
            '/type',
            'schema.root_object_required',
            'The content schema root type must be object'
        )
    }

    walkSchema(value, state, '', 0)

    return state.issues.length > 0 ? validationFailure(state.issues) : validationSuccess(value)
}

interface InstanceResourceState {
    readonly issues: ValidationIssue[]
    readonly seen: WeakSet<object>
    nodes: number
}

function walkInstance(
    value: unknown,
    state: InstanceResourceState,
    path: string,
    depth: number
): void {
    state.nodes += 1
    if (state.nodes > customSchemaLimits.maxInstanceNodes) {
        if (state.nodes === customSchemaLimits.maxInstanceNodes + 1) {
            state.issues.push({
                path,
                code: 'content.node_limit',
                message: `Content may contain at most ${customSchemaLimits.maxInstanceNodes} values`,
                severity: 'error',
                source: 'schema_policy',
            })
        }
        return
    }

    if (depth > customSchemaLimits.maxInstanceDepth) {
        state.issues.push({
            path,
            code: 'content.depth_limit',
            message: `Content depth cannot exceed ${customSchemaLimits.maxInstanceDepth}`,
            severity: 'error',
            source: 'schema_policy',
        })
        return
    }

    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return
    }

    if (typeof value !== 'object') {
        state.issues.push({
            path,
            code: 'content.invalid_json_value',
            message: 'Content must contain only JSON values',
            severity: 'error',
            source: 'schema_policy',
        })
        return
    }

    if (state.seen.has(value)) {
        state.issues.push({
            path,
            code: 'content.circular_value',
            message: 'Content must be a JSON value without cycles',
            severity: 'error',
            source: 'schema_policy',
        })
        return
    }

    state.seen.add(value)

    if (Array.isArray(value)) {
        if (value.length > customSchemaLimits.maxArrayItems) {
            state.issues.push({
                path,
                code: 'content.array_limit',
                message: `Content arrays may contain at most ${customSchemaLimits.maxArrayItems} items`,
                severity: 'error',
                source: 'schema_policy',
            })
        }
        for (let index = 0; index < value.length; index += 1) {
            if (!(index in value)) {
                state.issues.push({
                    path: childPath(path, index),
                    code: 'content.sparse_array',
                    message: 'Content arrays must not contain empty slots',
                    severity: 'error',
                    source: 'schema_policy',
                })
                continue
            }
            walkInstance(value[index], state, childPath(path, index), depth + 1)
        }
    } else if (isRecord(value)) {
        const entries = Object.entries(value)
        if (entries.length > customSchemaLimits.maxInstanceProperties) {
            state.issues.push({
                path,
                code: 'content.properties_limit',
                message: `Content objects may contain at most ${customSchemaLimits.maxInstanceProperties} properties`,
                severity: 'error',
                source: 'schema_policy',
            })
        }
        entries.forEach(([key, item]) => walkInstance(item, state, childPath(path, key), depth + 1))
    } else {
        state.issues.push({
            path,
            code: 'content.invalid_json_object',
            message: 'Content objects must be plain JSON objects',
            severity: 'error',
            source: 'schema_policy',
        })
    }

    state.seen.delete(value)
}

export function validateContentResourceLimits(value: unknown): readonly ValidationIssue[] {
    const state: InstanceResourceState = { issues: [], seen: new WeakSet(), nodes: 0 }
    walkInstance(value, state, '', 0)

    if (state.issues.length === 0) {
        try {
            const serialized = JSON.stringify(value)
            if (serialized === undefined) {
                throw new TypeError('Value is not JSON serializable')
            }
            const bytes = new TextEncoder().encode(serialized).byteLength
            if (bytes > customSchemaLimits.maxInstanceBytes) {
                state.issues.push({
                    path: '',
                    code: 'content.byte_limit',
                    message: `Content JSON cannot exceed ${customSchemaLimits.maxInstanceBytes} bytes`,
                    severity: 'error',
                    source: 'schema_policy',
                })
            }
        } catch {
            state.issues.push({
                path: '',
                code: 'content.invalid_json_value',
                message: 'Content must be serializable as JSON',
                severity: 'error',
                source: 'schema_policy',
            })
        }
    }

    return state.issues
}
