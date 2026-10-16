import { describe, expect, test } from 'bun:test'

import { ChannelProfileCompiler, type ChannelProfileDefinition } from '@postbot/core'
import { xChannelProfile } from '@postbot/x'

import { channelProfileTemplates, templatesFromPresets } from '../channel-profile-presets'
import { editProfileTextRule } from './channel-builder-projection'

function fixture(): ChannelProfileDefinition {
    return structuredClone(channelProfileTemplates[0]!.profile) as ChannelProfileDefinition
}

function apply(profile: ChannelProfileDefinition, edit: Parameters<typeof editProfileTextRule>[1]) {
    const result = editProfileTextRule(profile, edit)
    if (!result.ok) throw new Error(result.reason)
    return result.profile
}

function validate(profile: ChannelProfileDefinition, content: Record<string, unknown>) {
    const compiled = new ChannelProfileCompiler().compile(profile)
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues))
    return compiled.value.validate(content).ok
}

describe('isolated channel builder preservation spike', () => {
    test('no-op retains every field on manual and webhook templates', () => {
        for (const template of channelProfileTemplates) {
            const profile = template.profile as ChannelProfileDefinition
            const snapshot = structuredClone(profile)
            const output = apply(profile, { bindingId: 'body' })
            expect(output).toEqual(snapshot)
            expect(profile).toEqual(snapshot)
            expect(output).not.toBe(profile)
        }
    })

    test('required title is actually enforced without changing the message or transport', () => {
        for (const template of channelProfileTemplates) {
            const profile = template.profile as ChannelProfileDefinition
            const output = apply(profile, { bindingId: 'headline', required: true })
            expect(validate(output, { body: 'Announcement' })).toBe(false)
            expect(validate(output, { body: 'Announcement', headline: 'Launch' })).toBe(true)
            expect(validate(profile, { body: 'Announcement' })).toBe(true)
            expect(output.execution).toEqual(profile.execution)
            expect(output.capabilities).toEqual(profile.capabilities)
            expect(output.fieldBindings).toEqual(profile.fieldBindings)
        }
    })

    test('maximum updates both constraints and leaves unrelated media and metadata intact', () => {
        const profile = fixture()
        const output = apply(profile, { bindingId: 'body', maxLength: 5 })
        expect(validate(output, { body: 'Hello' })).toBe(true)
        expect(validate(output, { body: 'Hello!' })).toBe(false)
        expect(validate(profile, { body: 'Hello!' })).toBe(true)
        expect(output.capabilities.mediaFields).toEqual(profile.capabilities.mediaFields)
        expect(output.id).toBe(profile.id)
        expect(output.profileHash).toBe(profile.profileHash)
        expect(output.schemaHash).toBe(profile.schemaHash)
    })

    test('unrelated constrained title survives a message edit and keeps its validation', () => {
        const profile = fixture()
        const schema = profile.contentSchema as {
            properties: Record<string, Record<string, unknown>>
        }
        schema.properties.headline!.enum = ['Launch day']
        const output = apply(profile, { bindingId: 'body', maxLength: 100 })
        expect(output.contentSchema).toEqual({
            ...profile.contentSchema,
            properties: {
                ...schema.properties,
                body: { ...schema.properties.body, maxLength: 100 },
            },
        })
        expect(validate(output, { body: 'Announcement', headline: 'Other' })).toBe(false)
        expect(validate(output, { body: 'Announcement', headline: 'Launch day' })).toBe(true)
        expect(editProfileTextRule(profile, { bindingId: 'headline', maxLength: 100 }).ok).toBe(
            false
        )
    })

    test('independent grapheme and weighted limits are preserved', () => {
        const profile = fixture()
        Object.assign(profile, {
            capabilities: {
                ...profile.capabilities,
                textFields: profile.capabilities.textFields.map(field =>
                    field.bindingId === 'body' ? { ...field, maxGraphemes: 3 } : field
                ),
            },
        })
        const output = apply(profile, { bindingId: 'body', maxLength: 10 })
        expect(output.capabilities.textFields[0]?.maxGraphemes).toBe(3)
        expect(validate(output, { body: 'four' })).toBe(false)
        const derived = templatesFromPresets([
            {
                id: 'x',
                version: xChannelProfile.version,
                profile: xChannelProfile,
            },
        ])[0]!.profile as ChannelProfileDefinition
        Object.assign(derived, { execution: { kind: 'manual' } })
        const binding = derived.fieldBindings.find(field => field.semantic === 'primary_text')!
        const edited = apply(derived, { bindingId: binding.id, maxLength: 500 })
        expect(edited.capabilities.textFields[0]?.maxWeightedLength).toBe(
            derived.capabilities.textFields[0]?.maxWeightedLength
        )
        expect(edited.capabilities.textFields[0]?.weightedLengthAlgorithm).toBe(
            derived.capabilities.textFields[0]?.weightedLengthAlgorithm
        )
    })

    test('rejects provider-owned edits and invalid bounds without mutating input', () => {
        expect(editProfileTextRule(xChannelProfile, { bindingId: 'text', maxLength: 5 }).ok).toBe(
            false
        )
        for (const maxLength of [0, -1, 1.5, NaN, Infinity]) {
            const profile = fixture()
            const snapshot = structuredClone(profile)
            expect(editProfileTextRule(profile, { bindingId: 'body', maxLength }).ok).toBe(false)
            expect(profile).toEqual(snapshot)
        }
    })

    test('making message optional changes presence, not its minimum nonempty length', () => {
        const profile = fixture()
        const output = apply(profile, { bindingId: 'body', required: false })
        expect(validate(output, {})).toBe(true)
        expect(validate(output, { body: '' })).toBe(false)
        expect(validate(profile, {})).toBe(false)
        expect(apply(profile, { bindingId: 'body', required: true })).toEqual(profile)
    })

    test('rejects a maximum below the existing minimum and inconsistent dual bounds', () => {
        const profile = fixture()
        const schema = profile.contentSchema as {
            properties: Record<string, Record<string, unknown>>
        }
        schema.properties.body!.minLength = 10
        expect(new ChannelProfileCompiler().compile(profile).ok).toBe(true)
        expect(editProfileTextRule(profile, { bindingId: 'body', maxLength: 9 }).ok).toBe(false)
        const inconsistent = fixture()
        const different = inconsistent.contentSchema as {
            properties: Record<string, Record<string, unknown>>
        }
        different.properties.body!.maxLength = 100
        expect(new ChannelProfileCompiler().compile(inconsistent).ok).toBe(true)
        expect(editProfileTextRule(inconsistent, { bindingId: 'body', maxLength: 50 }).ok).toBe(
            false
        )
    })

    test('fails closed for root combinators and affected-field relations', () => {
        const profile = fixture()
        Object.assign(profile, {
            contentSchema: {
                ...profile.contentSchema,
                allOf: [
                    {
                        type: 'object',
                        properties: (
                            profile.contentSchema as { properties: Record<string, unknown> }
                        ).properties,
                        required: ['headline'],
                        additionalProperties: false,
                    },
                ],
            },
        })
        expect(new ChannelProfileCompiler().compile(profile).ok).toBe(true)
        expect(apply(profile, { bindingId: 'headline' })).toEqual(profile)
        expect(editProfileTextRule(profile, { bindingId: 'headline', required: false }).ok).toBe(
            false
        )
        const related = fixture()
        Object.assign(related, {
            capabilities: {
                ...related.capabilities,
                relations: [{ kind: 'requires', bindingId: 'headline', relatedBindingId: 'body' }],
            },
        })
        expect(new ChannelProfileCompiler().compile(related).ok).toBe(true)
        expect(editProfileTextRule(related, { bindingId: 'body', required: false }).ok).toBe(false)
    })
})
