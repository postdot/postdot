import { expect, test } from 'bun:test'

import {
    ChannelProfileCompiler,
    createManualChannelProfile,
    type ChannelProfileDefinition,
} from './index'

const compiler = new ChannelProfileCompiler()

test('malformed definitions produce field issues instead of throwing or entering schema compilation', () => {
    const mutations: [string, string, (profile: any) => void][] = [
        ['/capabilities', 'profile.object_required', p => delete p.capabilities],
        ['/fieldBindings', 'profile.array_required', p => (p.fieldBindings = null)],
        ['/execution', 'profile.object_required', p => delete p.execution],
        ['/fieldBindings/0/path', 'profile.string_required', p => (p.fieldBindings[0].path = 42)],
        [
            '/capabilities/textFields',
            'profile.array_required',
            p => (p.capabilities.textFields = {}),
        ],
        [
            '/capabilities/textFields/0/acceptedSourceFormats',
            'profile.array_required',
            p => (p.capabilities.textFields[0].acceptedSourceFormats = null),
        ],
        [
            '/capabilities/textFields/0/weightedLengthAlgorithm',
            'profile.string_required',
            p => (p.capabilities.textFields[0].weightedLengthAlgorithm = 42),
        ],
        ['/fieldBindings/3/item', 'profile.object_required', p => (p.fieldBindings[3].item = null)],
        [
            '/capabilities/mediaFields/0/dimensions',
            'profile.object_required',
            p => (p.capabilities.mediaFields[0].dimensions = []),
        ],
        [
            '/execution/contractId',
            'profile.string_required',
            p => (p.execution = { kind: 'built_in', contractId: 42, revision: '1' }),
        ],
    ]
    for (const [path, code, mutate] of mutations) {
        const profile = structuredClone(createManualChannelProfile())
        mutate(profile)
        const before = structuredClone(profile)
        const result = compiler.compile(profile)
        expect(result.ok).toBe(false)
        expect(result.issues).toContainEqual({
            path,
            code,
            message: expect.any(String),
            severity: 'error',
            source: 'domain',
        })
        expect(profile).toEqual(before)
    }
    expect(compiler.compile(createManualChannelProfile()).ok).toBe(true)
})

test('custom-schema policy pointers are rooted at the definition while semantic checks stay intact', () => {
    const original = structuredClone(createManualChannelProfile())
    const profile: ChannelProfileDefinition = {
        ...original,
        id: 'custom-structure',
        origin: 'custom',
        contentSchema: {
            ...original.contentSchema,
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            properties: { body: { type: 'string', maxLength: 100, pattern: 'fake-value' } },
        },
    }
    const result = new ChannelProfileCompiler().compile(profile)
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
        expect.objectContaining({
            path: '/contentSchema/properties/body/pattern',
            code: 'schema.keyword_forbidden',
        })
    )
    const negative = structuredClone(original) as any
    negative.capabilities.textFields[0].maxLength = -1
    expect(compiler.compile(negative).issues).toContainEqual(
        expect.objectContaining({ code: 'capability.limit_invalid' })
    )
})

test('malformed prepared profiles are module failures rather than runtime crashes', () => {
    const compiler = new ChannelProfileCompiler({
        validationAdapters: [
            {
                contractId: 'shape-probe',
                validate: () => [],
                prepareProfile: profile =>
                    ({ ...profile, capabilities: null }) as unknown as ChannelProfileDefinition,
            },
        ],
    })
    const original = createManualChannelProfile()
    const result = compiler.compile({
        ...original,
        execution: { kind: 'built_in', contractId: 'shape-probe', revision: '1' },
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
        expect.objectContaining({
            path: '/capabilities',
            code: 'profile.object_required',
            source: 'module',
        })
    )
})

test('an unknown text maximum is explicit null; omission and malformed limits remain invalid', () => {
    const original = createManualChannelProfile()
    const unknown = {
        ...original,
        capabilities: {
            ...original.capabilities,
            textFields: original.capabilities.textFields.map((field, index) =>
                index === 0 ? { ...field, maxLength: null } : field
            ),
        },
    }
    expect(compiler.compile(unknown).ok).toBe(true)
    for (const value of [undefined, 'unknown', -1, NaN, Infinity, 1.5]) {
        const malformed = structuredClone(unknown) as any
        if (value === undefined) delete malformed.capabilities.textFields[0].maxLength
        else malformed.capabilities.textFields[0].maxLength = value
        expect(compiler.compile(malformed).ok).toBe(false)
    }
    const known = structuredClone(original)
    expect(compiler.compile(known).ok).toBe(true)
    const field = known.capabilities.textFields[0]!
    const invalidRange = {
        ...known,
        capabilities: {
            ...known.capabilities,
            textFields: [{ ...field, minLength: 20, maxLength: 10 }],
        },
    }
    expect(compiler.compile(invalidRange).ok).toBe(false)
})
