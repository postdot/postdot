// JSON Schema Draft 2020-12 meta-schemas, reduced to their validation keywords.
// Source: https://json-schema.org/draft/2020-12/schema

const dialect = 'https://json-schema.org/draft/2020-12/schema'
const base = 'https://json-schema.org/draft/2020-12'

export const jsonSchema202012MetaSchemas = [
    {
        $schema: dialect,
        $id: `${base}/schema`,
        $vocabulary: {
            [`${base}/vocab/core`]: true,
            [`${base}/vocab/applicator`]: true,
            [`${base}/vocab/unevaluated`]: true,
            [`${base}/vocab/validation`]: true,
            [`${base}/vocab/meta-data`]: true,
            [`${base}/vocab/format-annotation`]: true,
            [`${base}/vocab/content`]: true,
        },
        $dynamicAnchor: 'meta',
        allOf: [
            { $ref: 'meta/core' },
            { $ref: 'meta/applicator' },
            { $ref: 'meta/unevaluated' },
            { $ref: 'meta/validation' },
            { $ref: 'meta/meta-data' },
            { $ref: 'meta/format-annotation' },
            { $ref: 'meta/content' },
        ],
        type: ['object', 'boolean'],
        properties: {
            definitions: {
                type: 'object',
                additionalProperties: { $dynamicRef: '#meta' },
                deprecated: true,
                default: {},
            },
            dependencies: {
                type: 'object',
                additionalProperties: {
                    anyOf: [
                        { $dynamicRef: '#meta' },
                        { $ref: 'meta/validation#/$defs/stringArray' },
                    ],
                },
                deprecated: true,
                default: {},
            },
            $recursiveAnchor: {
                $ref: 'meta/core#/$defs/anchorString',
                deprecated: true,
            },
            $recursiveRef: {
                $ref: 'meta/core#/$defs/uriReferenceString',
                deprecated: true,
            },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/core`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            $id: { $ref: '#/$defs/uriReferenceString', pattern: '^[^#]*#?$' },
            $schema: { $ref: '#/$defs/uriString' },
            $ref: { $ref: '#/$defs/uriReferenceString' },
            $anchor: { $ref: '#/$defs/anchorString' },
            $dynamicRef: { $ref: '#/$defs/uriReferenceString' },
            $dynamicAnchor: { $ref: '#/$defs/anchorString' },
            $vocabulary: {
                type: 'object',
                propertyNames: { $ref: '#/$defs/uriString' },
                additionalProperties: { type: 'boolean' },
            },
            $comment: { type: 'string' },
            $defs: {
                type: 'object',
                additionalProperties: { $dynamicRef: '#meta' },
            },
        },
        $defs: {
            anchorString: { type: 'string', pattern: '^[A-Za-z_][-A-Za-z0-9._]*$' },
            uriString: { type: 'string', format: 'uri' },
            uriReferenceString: { type: 'string', format: 'uri-reference' },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/applicator`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            prefixItems: { $ref: '#/$defs/schemaArray' },
            items: { $dynamicRef: '#meta' },
            contains: { $dynamicRef: '#meta' },
            additionalProperties: { $dynamicRef: '#meta' },
            properties: {
                type: 'object',
                additionalProperties: { $dynamicRef: '#meta' },
                default: {},
            },
            patternProperties: {
                type: 'object',
                additionalProperties: { $dynamicRef: '#meta' },
                propertyNames: { format: 'regex' },
                default: {},
            },
            dependentSchemas: {
                type: 'object',
                additionalProperties: { $dynamicRef: '#meta' },
                default: {},
            },
            propertyNames: { $dynamicRef: '#meta' },
            if: { $dynamicRef: '#meta' },
            // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema keyword
            then: { $dynamicRef: '#meta' },
            else: { $dynamicRef: '#meta' },
            allOf: { $ref: '#/$defs/schemaArray' },
            anyOf: { $ref: '#/$defs/schemaArray' },
            oneOf: { $ref: '#/$defs/schemaArray' },
            not: { $dynamicRef: '#meta' },
        },
        $defs: {
            schemaArray: {
                type: 'array',
                minItems: 1,
                items: { $dynamicRef: '#meta' },
            },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/unevaluated`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            unevaluatedItems: { $dynamicRef: '#meta' },
            unevaluatedProperties: { $dynamicRef: '#meta' },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/validation`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            type: {
                anyOf: [
                    { $ref: '#/$defs/simpleTypes' },
                    {
                        type: 'array',
                        items: { $ref: '#/$defs/simpleTypes' },
                        minItems: 1,
                        uniqueItems: true,
                    },
                ],
            },
            const: true,
            enum: { type: 'array', items: true },
            multipleOf: { type: 'number', exclusiveMinimum: 0 },
            maximum: { type: 'number' },
            exclusiveMaximum: { type: 'number' },
            minimum: { type: 'number' },
            exclusiveMinimum: { type: 'number' },
            maxLength: { $ref: '#/$defs/nonNegativeInteger' },
            minLength: { $ref: '#/$defs/nonNegativeIntegerDefault0' },
            pattern: { type: 'string', format: 'regex' },
            maxItems: { $ref: '#/$defs/nonNegativeInteger' },
            minItems: { $ref: '#/$defs/nonNegativeIntegerDefault0' },
            uniqueItems: { type: 'boolean', default: false },
            maxContains: { $ref: '#/$defs/nonNegativeInteger' },
            minContains: { $ref: '#/$defs/nonNegativeInteger', default: 1 },
            maxProperties: { $ref: '#/$defs/nonNegativeInteger' },
            minProperties: { $ref: '#/$defs/nonNegativeIntegerDefault0' },
            required: { $ref: '#/$defs/stringArray' },
            dependentRequired: {
                type: 'object',
                additionalProperties: { $ref: '#/$defs/stringArray' },
            },
        },
        $defs: {
            nonNegativeInteger: { type: 'integer', minimum: 0 },
            nonNegativeIntegerDefault0: {
                $ref: '#/$defs/nonNegativeInteger',
                default: 0,
            },
            simpleTypes: {
                enum: ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'],
            },
            stringArray: {
                type: 'array',
                items: { type: 'string' },
                uniqueItems: true,
                default: [],
            },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/meta-data`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            default: true,
            deprecated: { type: 'boolean', default: false },
            readOnly: { type: 'boolean', default: false },
            writeOnly: { type: 'boolean', default: false },
            examples: { type: 'array', items: true },
        },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/format-annotation`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: { format: { type: 'string' } },
    },
    {
        $schema: dialect,
        $id: `${base}/meta/content`,
        $dynamicAnchor: 'meta',
        type: ['object', 'boolean'],
        properties: {
            contentEncoding: { type: 'string' },
            contentMediaType: { type: 'string' },
            contentSchema: { $dynamicRef: '#meta' },
        },
    },
] as const
