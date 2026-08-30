import { describe, expect, test } from 'bun:test'

import {
    customSchemaLimits,
    jsonSchema202012Dialect,
    validateContentResourceLimits,
    validateCustomContentSchema,
} from './json-schema-policy'

function objectSchema(properties: Record<string, unknown> = {}) {
    return {
        $schema: jsonSchema202012Dialect,
        type: 'object',
        properties,
        additionalProperties: false,
    }
}

function codes(schema: unknown): string[] {
    return validateCustomContentSchema(schema).issues.map(issue => issue.code)
}

describe('custom schema policy', () => {
    test('requires a plain Draft 2020-12 object schema', () => {
        expect(codes(true)).toContain('schema.root_object_required')
        expect(codes([])).toContain('schema.root_object_required')
        expect(codes({ type: 'object', properties: {}, additionalProperties: false })).toContain(
            'schema.dialect_required'
        )
        expect(
            codes({
                ...objectSchema(),
                properties: {
                    nested: {
                        $schema: jsonSchema202012Dialect,
                        type: 'string',
                        maxLength: 10,
                    },
                },
            })
        ).toContain('schema.nested_dialect_forbidden')
    })

    test('rejects invalid JSON values and oversized schema documents', () => {
        const circular = objectSchema() as Record<string, unknown>
        circular.self = circular
        expect(codes(circular)).toContain('schema.circular_value')

        const withFunction = objectSchema({ value: { type: 'string', maxLength: 1 } }) as Record<
            string,
            unknown
        >
        withFunction.default = () => undefined
        expect(codes(withFunction)).toContain('schema.invalid_json_value')

        expect(
            codes({ ...objectSchema(), title: 'x'.repeat(customSchemaLimits.maxSchemaBytes) })
        ).toContain('schema.byte_limit')
    })

    test('bounds object shape, definitions, nodes, and depth', () => {
        const tooManyProperties = Object.fromEntries(
            Array.from({ length: customSchemaLimits.maxPropertiesPerObject + 1 }, (_, index) => [
                `field${index}`,
                { type: 'string', maxLength: 1 },
            ])
        )
        expect(codes(objectSchema(tooManyProperties))).toContain('schema.properties_limit')

        const definitions = Object.fromEntries(
            Array.from({ length: customSchemaLimits.maxDefinitions + 1 }, (_, index) => [
                `value${index}`,
                { type: 'string', maxLength: 1 },
            ])
        )
        expect(codes({ ...objectSchema(), $defs: definitions })).toContain(
            'schema.definitions_limit'
        )

        const wide = Object.fromEntries(
            Array.from({ length: customSchemaLimits.maxPropertiesPerObject }, (_, index) => [
                `group${index}`,
                {
                    type: 'object',
                    properties: Object.fromEntries(
                        Array.from({ length: 4 }, (_, childIndex) => [
                            `value${childIndex}`,
                            { type: 'string', maxLength: 1 },
                        ])
                    ),
                    additionalProperties: false,
                },
            ])
        )
        expect(codes(objectSchema(wide))).toContain('schema.node_limit')

        let nested: Record<string, unknown> = { type: 'string', maxLength: 1 }
        for (let depth = 0; depth <= customSchemaLimits.maxSchemaDepth; depth += 1) {
            nested = {
                type: 'object',
                properties: { nested },
                additionalProperties: false,
            }
        }
        expect(codes(objectSchema({ nested }))).toContain('schema.depth_limit')
    })

    test('requires explicit closed object fields and consistent property bounds', () => {
        expect(codes({ ...objectSchema(), properties: [] })).toContain('schema.keyword_type')
        expect(
            codes({
                ...objectSchema({ known: { type: 'string', maxLength: 1 } }),
                required: ['known', 'known', 'missing'],
            })
        ).toEqual(
            expect.arrayContaining([
                'schema.required_duplicate',
                'schema.required_unknown_property',
            ])
        )
        expect(codes({ ...objectSchema(), additionalProperties: true })).toContain(
            'schema.additional_properties_forbidden'
        )
        expect(codes({ ...objectSchema(), minProperties: 2, maxProperties: 1 })).toContain(
            'schema.invalid_range'
        )
        expect(
            codes({
                ...objectSchema(),
                maxProperties: customSchemaLimits.maxPropertiesPerObject + 1,
            })
        ).toContain('schema.properties_limit')

        const properties = Object.create(null) as Record<string, unknown>
        properties['constructor'] = { type: 'string', maxLength: 1 }
        expect(codes(objectSchema(properties))).toContain('schema.unsafe_property_name')
    })

    test('requires bounded arrays and validates tuple controls', () => {
        expect(
            codes(
                objectSchema({ values: { type: 'array', items: { type: 'string', maxLength: 1 } } })
            )
        ).toContain('schema.array_maximum_required')
        expect(
            codes(
                objectSchema({
                    values: {
                        type: 'array',
                        maxItems: customSchemaLimits.maxArrayItems + 1,
                        items: { type: 'string', maxLength: 1 },
                    },
                })
            )
        ).toContain('schema.array_limit')
        expect(codes(objectSchema({ values: { type: 'array', maxItems: 1 } }))).toContain(
            'schema.array_items_required'
        )
        expect(
            codes(
                objectSchema({
                    values: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 1,
                        items: { type: 'string', maxLength: 1 },
                        uniqueItems: 'yes',
                    },
                })
            )
        ).toEqual(expect.arrayContaining(['schema.invalid_range', 'schema.keyword_type']))
        expect(
            codes(
                objectSchema({
                    values: {
                        type: 'array',
                        maxItems: 20,
                        prefixItems: Array.from(
                            { length: customSchemaLimits.maxCompositionBranches + 1 },
                            () => ({ type: 'string', maxLength: 1 })
                        ),
                    },
                })
            )
        ).toContain('schema.composition_limit')
    })

    test('validates scalar limits, enums, annotations, and keyword types', () => {
        expect(
            codes(
                objectSchema({
                    value: { type: 'string', minLength: 2, maxLength: 1 },
                })
            )
        ).toContain('schema.invalid_range')
        expect(
            codes(
                objectSchema({
                    value: {
                        type: 'string',
                        maxLength: customSchemaLimits.maxStringLength + 1,
                    },
                })
            )
        ).toContain('schema.string_limit')
        expect(codes(objectSchema({ value: { type: 'unknown' } }))).toContain('schema.keyword_type')
        expect(codes(objectSchema({ value: { enum: [] } }))).toContain('schema.keyword_type')
        expect(
            codes(
                objectSchema({
                    value: {
                        enum: Array.from(
                            { length: customSchemaLimits.maxEnumValues + 1 },
                            (_, index) => index
                        ),
                    },
                })
            )
        ).toContain('schema.enum_limit')
        expect(
            codes({
                ...objectSchema(),
                title: 42,
                deprecated: 'yes',
                examples: 'none',
                multipleOf: 0,
            })
        ).toEqual(expect.arrayContaining(['schema.keyword_type', 'schema.invalid_multiple']))
    })

    test('limits local references and validates definition targets', () => {
        const valid = {
            ...objectSchema({ body: { $ref: '#/$defs/body' } }),
            $defs: { body: { type: 'string', maxLength: 100 } },
        }
        expect(validateCustomContentSchema(valid).ok).toBe(true)

        expect(codes({ ...objectSchema({ body: { $ref: 42 } }) })).toContain(
            'schema.reference_forbidden'
        )
        expect(codes({ ...objectSchema(), $defs: [] })).toContain('schema.keyword_type')
    })

    test('bounds compositions, conditional schemas, and dependencies', () => {
        expect(codes(objectSchema({ value: { anyOf: [] } }))).toContain('schema.keyword_type')
        expect(
            codes(
                objectSchema({
                    value: {
                        oneOf: Array.from(
                            { length: customSchemaLimits.maxCompositionBranches + 1 },
                            (_, index) => ({ const: index })
                        ),
                    },
                })
            )
        ).toContain('schema.composition_limit')
        expect(codes({ ...objectSchema(), dependentSchemas: [] })).toContain('schema.keyword_type')
        expect(codes({ ...objectSchema(), dependentRequired: [] })).toContain('schema.keyword_type')
        expect(codes({ ...objectSchema(), dependentRequired: { field: ['one', 2] } })).toContain(
            'schema.keyword_type'
        )
        expect(codes({ ...objectSchema(), unevaluatedProperties: { type: 'string' } })).toContain(
            'schema.unevaluated_value_forbidden'
        )
    })
})

describe('content resource policy', () => {
    test('accepts bounded JSON and rejects non-JSON values', () => {
        expect(validateContentResourceLimits({ body: 'Hello', media: [] })).toEqual([])
        expect(
            validateContentResourceLimits({ value: undefined }).map(issue => issue.code)
        ).toContain('content.invalid_json_value')
        expect(
            validateContentResourceLimits({ value: Number.NaN }).map(issue => issue.code)
        ).toContain('content.invalid_json_value')
        expect(
            validateContentResourceLimits({ value: new Date() }).map(issue => issue.code)
        ).toContain('content.invalid_json_object')

        const sparse: unknown[] = []
        sparse.length = 2
        sparse[1] = 'value'
        expect(validateContentResourceLimits(sparse).map(issue => issue.code)).toContain(
            'content.sparse_array'
        )
    })

    test('enforces byte, depth, array, property, and node limits', () => {
        expect(
            validateContentResourceLimits('x'.repeat(customSchemaLimits.maxInstanceBytes + 1)).map(
                issue => issue.code
            )
        ).toContain('content.byte_limit')
        expect(
            validateContentResourceLimits(
                Array.from({ length: customSchemaLimits.maxArrayItems + 1 }, () => null)
            ).map(issue => issue.code)
        ).toContain('content.array_limit')

        const properties = Object.fromEntries(
            Array.from({ length: customSchemaLimits.maxInstanceProperties + 1 }, (_, index) => [
                `field${index}`,
                index,
            ])
        )
        expect(validateContentResourceLimits(properties).map(issue => issue.code)).toContain(
            'content.properties_limit'
        )

        let nested: Record<string, unknown> = {}
        for (let depth = 0; depth <= customSchemaLimits.maxInstanceDepth; depth += 1) {
            nested = { nested }
        }
        expect(validateContentResourceLimits(nested).map(issue => issue.code)).toContain(
            'content.depth_limit'
        )

        const manyNodes = Array.from({ length: 1_000 }, () =>
            Array.from({ length: 101 }, () => null)
        )
        expect(validateContentResourceLimits(manyNodes).map(issue => issue.code)).toContain(
            'content.node_limit'
        )
    })
})
