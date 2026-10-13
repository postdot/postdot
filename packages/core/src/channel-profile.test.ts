import { describe, expect, test } from 'bun:test'

import { Type } from 'typebox'

import {
    ChannelProfileCompiler,
    customSchemaLimits,
    jsonSchema202012Dialect,
    type ChannelProfileDefinition,
    validateCustomContentSchema,
} from './index'

const microblogSchema = {
    $schema: jsonSchema202012Dialect,
    type: 'object',
    properties: {
        body: { type: 'string', minLength: 1, maxLength: 500 },
        media: {
            type: 'array',
            maxItems: 4,
            items: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', minLength: 1, maxLength: 255 },
                    alt: { type: 'string', maxLength: 1_000 },
                },
                required: ['assetId'],
                additionalProperties: false,
            },
        },
    },
    required: ['body', 'media'],
    additionalProperties: false,
} as const

function createMicroblogProfile(
    overrides: Partial<ChannelProfileDefinition> = {}
): ChannelProfileDefinition {
    return {
        id: 'custom-microblog',
        version: 1,
        profileHash: 'sha256:custom-microblog-profile-v1',
        schemaHash: 'sha256:microblog-v1',
        origin: 'custom',
        contentSchema: structuredClone(microblogSchema),
        fieldBindings: [
            { id: 'body', semantic: 'primary_text', path: '/body' },
            {
                id: 'media',
                semantic: 'ordered_media',
                path: '/media',
                item: { assetIdPath: '/assetId', accessibilityTextPath: '/alt' },
            },
        ],
        capabilities: {
            revision: 'microblog-v1',
            textFields: [
                {
                    bindingId: 'body',
                    acceptedSourceFormats: ['plain_text'],
                    minLength: 1,
                    maxLength: 500,
                },
            ],
            mediaFields: [
                {
                    bindingId: 'media',
                    families: ['image'],
                    mimeTypes: ['image/jpeg', 'image/png'],
                    maxItems: 4,
                    maxBytesPerItem: 8_000_000,
                },
            ],
            relations: [],
        },
        execution: { kind: 'manual' },
        ...overrides,
    }
}

describe('bounded custom JSON Schema profile', () => {
    test('accepts and JIT-compiles a representative custom microblog', () => {
        const compiler = new ChannelProfileCompiler()
        const compiled = compiler.compile(createMicroblogProfile())

        expect(compiled.ok).toBe(true)
        expect(compiler.size).toBe(1)
        if (!compiled.ok) return

        expect(compiled.value.accelerated).toBe(true)
        expect(compiled.value.validate({ body: 'Hello', media: [] }).ok).toBe(true)

        const rejected = compiled.value.validate({ body: 'x'.repeat(501), media: [] })
        expect(rejected.ok).toBe(false)
        expect(rejected.issues).toContainEqual(
            expect.objectContaining({ code: 'schema.maxLength', path: '/body' })
        )

        const graphemeProfile = createMicroblogProfile({
            capabilities: {
                ...createMicroblogProfile().capabilities,
                textFields: [
                    {
                        bindingId: 'body',
                        acceptedSourceFormats: ['plain_text'],
                        minLength: 1,
                        maxLength: 500,
                        maxGraphemes: 3,
                    },
                ],
            },
        })
        const graphemeCompiled = new ChannelProfileCompiler().compile(graphemeProfile)
        expect(graphemeCompiled.ok).toBe(true)
        if (!graphemeCompiled.ok) return

        const graphemeLimited = graphemeCompiled.value.validate({
            body: 'a👩‍👩‍👧‍👦!x',
            media: [],
        })
        expect(graphemeLimited.ok).toBe(false)
        expect(graphemeLimited.issues).toContainEqual(
            expect.objectContaining({ code: 'content.grapheme_limit', path: '/body' })
        )
    })

    test('supports a richer project blog shape without provider-specific core code', () => {
        const blogSchema = {
            $schema: jsonSchema202012Dialect,
            type: 'object',
            properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                body: { type: 'string', minLength: 1, maxLength: 100_000 },
                slug: { type: 'string', maxLength: 200 },
                tags: {
                    type: 'array',
                    maxItems: 20,
                    items: { type: 'string', minLength: 1, maxLength: 50 },
                },
            },
            required: ['title', 'body'],
            additionalProperties: false,
        } as const
        const profile = createMicroblogProfile({
            id: 'project-blog',
            schemaHash: 'sha256:project-blog-v1',
            contentSchema: blogSchema,
            fieldBindings: [
                { id: 'title', semantic: 'headline', path: '/title' },
                { id: 'body', semantic: 'primary_text', path: '/body' },
                { id: 'tags', semantic: 'tags', path: '/tags' },
            ],
            capabilities: {
                revision: 'project-blog-v1',
                textFields: [
                    {
                        bindingId: 'title',
                        acceptedSourceFormats: ['plain_text'],
                        maxLength: 200,
                    },
                    {
                        bindingId: 'body',
                        acceptedSourceFormats: ['markdown'],
                        maxLength: 100_000,
                    },
                ],
                mediaFields: [],
                relations: [],
            },
            execution: {
                kind: 'declarative_http',
                contractId: 'project-blog-webhook',
                revision: '1',
                mode: 'postbot_webhook',
            },
        })

        const compiled = new ChannelProfileCompiler().compile(profile)
        expect(compiled.ok).toBe(true)
        if (compiled.ok) {
            expect(
                compiled.value.validate({
                    title: 'A durable boundary',
                    body: '# Publication content',
                    tags: ['architecture'],
                }).ok
            ).toBe(true)
        }
    })

    test('rejects unsafe and unbounded custom schema features', () => {
        const schema = structuredClone(microblogSchema) as Record<string, unknown>
        const properties = schema.properties as Record<string, Record<string, unknown>>
        const body = properties.body as Record<string, unknown>
        body.pattern = '^(a+)+$'
        delete body.maxLength
        schema['x-executable-transform'] = 'return content'

        const result = validateCustomContentSchema(schema)

        expect(result.ok).toBe(false)
        const codes = result.issues.map(issue => issue.code)
        expect(codes).toContain('schema.keyword_forbidden')
        expect(codes).toContain('schema.keyword_unknown')
        expect(codes).toContain('schema.string_maximum_required')
    })

    test('validates keyword shapes against the Draft 2020-12 meta-schema', () => {
        const schema = structuredClone(microblogSchema) as Record<string, unknown>
        const properties = schema.properties as Record<string, Record<string, unknown>>
        properties.body = { type: 'string', maxLength: 'five hundred' }

        const result = validateCustomContentSchema(schema)

        expect(result.ok).toBe(false)
        expect(result.issues.some(issue => issue.code.startsWith('schema.meta.'))).toBe(true)
        expect(result.issues).toContainEqual(
            expect.objectContaining({
                code: 'schema.keyword_type',
                path: '/properties/body/maxLength',
            })
        )
    })

    test('rejects remote and missing references before compilation', () => {
        const remote = structuredClone(microblogSchema) as Record<string, unknown>
        ;(remote.properties as Record<string, unknown>).body = {
            $ref: 'https://example.com/schemas/body.json',
        }
        const missing = structuredClone(microblogSchema) as Record<string, unknown>
        ;(missing.properties as Record<string, unknown>).body = { $ref: '#/$defs/missing' }

        expect(validateCustomContentSchema(remote).issues.map(issue => issue.code)).toContain(
            'schema.reference_forbidden'
        )
        expect(validateCustomContentSchema(missing).issues.map(issue => issue.code)).toContain(
            'schema.reference_missing'
        )
    })

    test('enforces composition and schema-node resource ceilings', () => {
        const tooManyBranches = structuredClone(microblogSchema) as Record<string, unknown>
        ;(tooManyBranches.properties as Record<string, unknown>).body = {
            anyOf: Array.from(
                { length: customSchemaLimits.maxCompositionBranches + 1 },
                (_, index) => ({ const: `value-${index}` })
            ),
        }

        const properties = Object.fromEntries(
            Array.from({ length: customSchemaLimits.maxPropertiesPerObject + 1 }, (_, index) => [
                `field${index}`,
                { type: 'string', maxLength: 10 },
            ])
        )
        const tooManyProperties = {
            $schema: jsonSchema202012Dialect,
            type: 'object',
            properties,
            additionalProperties: false,
        }

        expect(
            validateCustomContentSchema(tooManyBranches).issues.map(issue => issue.code)
        ).toContain('schema.composition_limit')
        expect(
            validateCustomContentSchema(tooManyProperties).issues.map(issue => issue.code)
        ).toContain('schema.properties_limit')
    })

    test('rejects bindings and capabilities that do not match the schema', () => {
        const profile = createMicroblogProfile({
            fieldBindings: [{ id: 'missing', semantic: 'primary_text', path: '/does-not-exist' }],
            capabilities: {
                revision: 'broken-v1',
                textFields: [
                    {
                        bindingId: 'other',
                        acceptedSourceFormats: ['plain_text'],
                        maxLength: 10,
                    },
                ],
                mediaFields: [],
                relations: [],
            },
        })

        const result = new ChannelProfileCompiler().compile(profile)

        expect(result.ok).toBe(false)
        expect(result.issues.map(issue => issue.code)).toEqual(
            expect.arrayContaining(['binding.path_missing', 'capability.binding_missing'])
        )
    })

    test('does not coerce values or insert schema defaults', () => {
        const compiler = new ChannelProfileCompiler()
        const compiled = compiler.compile(createMicroblogProfile())
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        const content = { body: 123, media: [] }
        const before = structuredClone(content)
        const result = compiled.value.validate(content)

        expect(result.ok).toBe(false)
        expect(content).toEqual(before)
    })

    test('rejects oversized and cyclic content before structural validation', () => {
        const compiled = new ChannelProfileCompiler().compile(createMicroblogProfile())
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        const oversized = compiled.value.validate({
            body: 'x'.repeat(customSchemaLimits.maxInstanceBytes),
            media: [],
        })
        expect(oversized.ok).toBe(false)
        expect(oversized.issues.map(issue => issue.code)).toContain('content.byte_limit')

        const cyclic: Record<string, unknown> = { body: 'Hello', media: [] }
        cyclic.self = cyclic
        const cycleResult = compiled.value.validate(cyclic)
        expect(cycleResult.ok).toBe(false)
        expect(cycleResult.issues.map(issue => issue.code)).toContain('content.circular_value')
    })

    test('snapshots immutable profiles and rejects cache identity conflicts', () => {
        const compiler = new ChannelProfileCompiler()
        const profile = createMicroblogProfile()
        const compiled = compiler.compile(profile)
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        ;(
            profile.contentSchema as { properties: { body: { maxLength: number } } }
        ).properties.body.maxLength = 10

        expect(
            (
                compiled.value.profile.contentSchema as {
                    properties: { body: { maxLength: number } }
                }
            ).properties.body.maxLength
        ).toBe(500)
        expect(() => {
            ;(
                compiled.value.profile.contentSchema as {
                    properties: { body: { maxLength: number } }
                }
            ).properties.body.maxLength = 20
        }).toThrow()

        const conflicting = compiler.compile(profile)
        expect(conflicting.ok).toBe(false)
        expect(conflicting.issues.map(issue => issue.code)).toContain(
            'profile.schema_hash_conflict'
        )
    })

    test('normalizes deterministic module checks into the shared result', async () => {
        const compiled = new ChannelProfileCompiler().compile(createMicroblogProfile())
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        const result = await compiled.value.validateWithRules(
            { body: 'Reserved provider word', media: [] },
            [
                content =>
                    String(content.body).includes('Reserved')
                        ? [
                              {
                                  path: '/body',
                                  code: 'provider.reserved_word',
                                  message: 'The provider rejects this reserved word',
                                  severity: 'error',
                                  source: 'module',
                              },
                          ]
                        : [],
            ]
        )

        expect(result.ok).toBe(false)
        expect(result.issues).toContainEqual(
            expect.objectContaining({ code: 'provider.reserved_word', source: 'module' })
        )
    })

    test('accepts trusted built-in TypeBox schemas through the same validator API', () => {
        const builtInSchema = Type.Object(
            { body: Type.String({ minLength: 1, maxLength: 3, pattern: '^[A-Z]+$' }) },
            { additionalProperties: false }
        )
        const profile = createMicroblogProfile({
            id: 'built-in-test',
            origin: 'built_in',
            schemaHash: 'sha256:built-in-test-v1',
            contentSchema: builtInSchema,
            fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
            capabilities: {
                revision: 'built-in-test-v1',
                textFields: [
                    {
                        bindingId: 'body',
                        acceptedSourceFormats: ['plain_text'],
                        minLength: 1,
                        maxLength: 3,
                    },
                ],
                mediaFields: [],
                relations: [],
            },
        })

        const compiled = new ChannelProfileCompiler().compile(profile)
        expect(compiled.ok).toBe(true)
        if (compiled.ok) {
            expect(compiled.value.validate({ body: 'ABC' }).ok).toBe(true)
            expect(compiled.value.validate({ body: 'abc' }).ok).toBe(false)
        }
    })
})
