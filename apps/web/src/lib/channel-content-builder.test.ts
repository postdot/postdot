import { describe, expect, test } from 'bun:test'

import { ChannelProfileCompiler, type ChannelProfileDefinition } from '@postdot/core'

import {
    editBuilderField,
    projectBuilderFields,
    compareBuilderRules,
    setBuilderTitleMode,
} from './channel-content-builder'
import { channelProfileTemplates } from './channel-profile-presets'

function fixture() {
    return structuredClone(channelProfileTemplates[0]!.profile) as unknown as Record<
        string,
        unknown
    >
}
function edit(profile: unknown, id: string, changes: Parameters<typeof editBuilderField>[2]) {
    const result = editBuilderField(profile, id, changes)
    if (!result.ok) throw new Error(result.reason)
    const compiled = new ChannelProfileCompiler().compile(
        result.profile as unknown as ChannelProfileDefinition
    )
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues))
    return {
        profile: result.profile,
        validate: (content: Record<string, unknown>) => compiled.value.validate(content).ok,
    }
}
describe('structured channel content adapter', () => {
    test('projects real text and media fields without changing the definition', () => {
        const profile = fixture()
        const original = structuredClone(profile)
        expect(projectBuilderFields(profile).map(field => [field.id, field.reason])).toEqual([
            ['body', undefined],
            ['headline', undefined],
            ['language', undefined],
            ['media', undefined],
        ])
        expect(profile).toEqual(original)
        expect(editBuilderField(profile, 'body', {}).ok).toBe(true)
        const result = editBuilderField(profile, 'body', {})
        if (result.ok) expect(result.profile).toEqual(profile)
    })
    test('applies required title, length and formats while preserving execution', () => {
        const profile = fixture()
        const result = edit(profile, 'headline', {
            required: true,
            maximum: 20,
            formats: ['plain_text'],
        })
        expect(result.validate({ body: 'Message' })).toBe(false)
        expect(result.validate({ body: 'Message', headline: 'Launch' })).toBe(true)
        expect(result.validate({ body: 'Message', headline: 'a'.repeat(21) })).toBe(false)
        expect(result.profile.execution).toEqual(profile.execution)
        expect(
            (result.profile.capabilities as { textFields: { acceptedSourceFormats: string[] }[] })
                .textFields[1]?.acceptedSourceFormats
        ).toEqual(['plain_text'])
    })
    test('changes permitted media families and enforces a matching MIME list and count', () => {
        const profile = fixture()
        const result = edit(profile, 'media', {
            families: ['image'],
            maximum: 1,
            maxBytes: 5_000_000,
        })
        const cap = (result.profile.capabilities as { mediaFields: Record<string, unknown>[] })
            .mediaFields[0]
        expect(cap?.families).toEqual(['image'])
        expect(cap?.mimeTypes).toEqual(['image/*'])
        expect(cap?.maxBytesPerItem).toBe(5_000_000)
        expect(
            result.validate({ body: 'Message', media: [{ assetId: 'one' }, { assetId: 'two' }] })
        ).toBe(false)
        expect(result.validate({ body: 'Message', media: [{ assetId: 'one' }] })).toBe(true)
        expect(
            edit(profile, 'media', { maximum: 0 }).validate({
                body: 'Message',
                media: [{ assetId: 'one' }],
            })
        ).toBe(false)
        expect(profile).toEqual(fixture())
    })
    test('refuses inconsistent, composed and provider-owned profiles without mutation', () => {
        const profile = fixture()
        profile.execution = { kind: 'built_in', contractId: 'x', revision: 'v1' }
        expect(editBuilderField(profile, 'body', { maximum: 10 })).toEqual({
            ok: false,
            reason: 'provider',
        })
        const composed = fixture()
        ;(composed.contentSchema as Record<string, unknown>).allOf = []
        expect(editBuilderField(composed, 'body', { maximum: 10 }).ok).toBe(false)
        const inconsistent = fixture()
        const schema = inconsistent.contentSchema as {
            properties: { body: Record<string, unknown> }
        }
        schema.properties.body.maxLength = 50
        expect(projectBuilderFields(inconsistent)[0]?.reason).toBe('mismatch')
    })
    test('rejects references even from a sibling because edits could change its meaning', () => {
        const profile = fixture()
        const schema = profile.contentSchema as { properties: Record<string, unknown> }
        schema.properties.extra = { $ref: '#/properties/body' }
        expect(editBuilderField(profile, 'body', { maximum: 10 }).ok).toBe(false)
    })
    test('preserves unrelated enum, counters and media constraints', () => {
        const profile = fixture()
        const schema = profile.contentSchema as {
            properties: { headline: Record<string, unknown> }
        }
        schema.properties.headline.enum = ['Launch']
        const capabilities = profile.capabilities as {
            textFields: Record<string, unknown>[]
            mediaFields: unknown
        }
        capabilities.textFields[0]!.maxGraphemes = 3
        const result = edit(profile, 'body', { maximum: 100 })
        expect(result.validate({ body: 'four' })).toBe(false)
        expect(result.validate({ body: 'Hi', headline: 'Other' })).toBe(false)
        expect((result.profile.capabilities as typeof capabilities).mediaFields).toEqual(
            capabilities.mediaFields
        )
        expect(editBuilderField(profile, 'headline', { maximum: 100 }).ok).toBe(false)
    })
    test('rejects empty families, formats, negative, fractional and non-finite bounds', () => {
        for (const value of [-1, 1.5, Infinity, NaN])
            expect(editBuilderField(fixture(), 'body', { maximum: value }).ok).toBe(false)
        expect(editBuilderField(fixture(), 'media', { families: [] }).ok).toBe(false)
        expect(editBuilderField(fixture(), 'body', { formats: [] }).ok).toBe(false)
    })
})

describe('content control comparison', () => {
    test('reports required and maximum changes once, despite duplicated runtime constraints', () => {
        const original = fixture()
        const output = edit(original, 'headline', { required: true, maximum: 50 }).profile
        const changes = compareBuilderRules(original, output)
        expect(changes.map(item => [item.field.id, item.rule, item.before, item.after])).toEqual([
            ['headline', 'required', false, true],
            ['headline', 'maximum', 10000, 50],
        ])
        expect(compareBuilderRules(original, original)).toEqual([])
    })
    test('compares media families and size without claiming transport coverage', () => {
        const original = fixture()
        const output = edit(original, 'media', { families: ['image'], maxBytes: 5000000 }).profile
        expect(compareBuilderRules(original, output).map(item => item.rule)).toEqual([
            'families',
            'maxBytes',
        ])
        expect(
            compareBuilderRules(original, {
                ...original,
                execution: { kind: 'manual', revision: 'other' },
            })
        ).toEqual([])
    })
})

describe('three title states', () => {
    function change(
        profile: unknown,
        mode: Parameters<typeof setBuilderTitleMode>[1],
        saved?: unknown
    ) {
        const result = setBuilderTitleMode(profile, mode, saved)
        if (!result.ok) throw new Error(result.reason)
        const compiled = new ChannelProfileCompiler().compile(
            result.profile as unknown as ChannelProfileDefinition
        )
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues))
        return {
            profile: result.profile,
            validate: (content: Record<string, unknown>) => compiled.value.validate(content).ok,
        }
    }
    test('absent removes the schema property, binding and capability; optional and required differ', () => {
        const original = fixture()
        const absent = change(original, 'absent')
        expect(
            projectBuilderFields(absent.profile).some(field => field.semantic === 'headline')
        ).toBe(false)
        expect(absent.validate({ body: 'Hello', headline: 'Not supported' })).toBe(false)
        const optional = change(absent.profile, 'optional')
        expect(optional.validate({ body: 'Hello' })).toBe(true)
        expect(optional.validate({ body: 'Hello', headline: 'A title' })).toBe(true)
        const required = change(optional.profile, 'required')
        expect(required.validate({ body: 'Hello' })).toBe(false)
        expect(required.validate({ body: 'Hello', headline: 'A title' })).toBe(true)
        expect(original).toEqual(fixture())
    })
    test('restores title rules while preserving unrelated edits made during absence', () => {
        const original = edit(fixture(), 'headline', { maximum: 53, formats: ['markdown'] }).profile
        const absent = change(original, 'absent').profile
        const bodyChanged = edit(absent, 'body', { maximum: 100 }).profile
        const restored = change(bodyChanged, 'optional', original).profile
        expect(
            projectBuilderFields(restored).find(field => field.semantic === 'headline')?.maximum
        ).toBe(53)
        expect(
            projectBuilderFields(restored).find(field => field.semantic === 'headline')?.formats
        ).toEqual(['markdown'])
        expect(
            projectBuilderFields(restored).find(field => field.semantic === 'primary_text')?.maximum
        ).toBe(100)
        expect(
            compareBuilderRules(original, absent).map(item => [item.rule, item.before, item.after])
        ).toEqual([['present', true, false]])
    })
    test('cannot remove a title used by relations or add one over an existing unbound field', () => {
        const original = fixture()
        const cap = original.capabilities as Record<string, unknown>
        cap.relations = [{ kind: 'requires', bindingId: 'headline', relatedBindingId: 'body' }]
        expect(setBuilderTitleMode(original, 'absent').ok).toBe(false)
        const absent = change(fixture(), 'absent').profile
        const schema = absent.contentSchema as { properties: Record<string, unknown> }
        schema.properties.headline = { type: 'string', maxLength: 20 }
        expect(setBuilderTitleMode(absent, 'optional').ok).toBe(false)
        absent.execution = { kind: 'built_in', contractId: 'x', revision: 'v1' }
        expect(setBuilderTitleMode(absent, 'optional').ok).toBe(false)
    })
})
