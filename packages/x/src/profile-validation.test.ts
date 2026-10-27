import { describe, expect, it } from 'bun:test'

import {
    ChannelProfileCompiler,
    type ChannelProfileDefinition,
    type JsonSchema,
} from '@postdot/core'

import { xChannelProfile } from './profile'
import { xChannelProfileValidationAdapter } from './profile-validation'

function compiler() {
    return new ChannelProfileCompiler({
        validationAdapters: [xChannelProfileValidationAdapter],
    })
}

function legacyXProfile(): ChannelProfileDefinition {
    const currentSchema = xChannelProfile.contentSchema as JsonSchema
    const currentProperties = currentSchema.properties as Record<string, unknown>

    return {
        ...xChannelProfile,
        version: 1,
        profileHash: 'sha256:postdot-x-post-v1',
        schemaHash: 'sha256:postdot-x-post-schema-v1',
        contentSchema: {
            ...currentSchema,
            properties: {
                ...currentProperties,
                text: { type: 'string', minLength: 1, maxLength: 280 },
            },
        },
        capabilities: {
            ...xChannelProfile.capabilities,
            revision: 'x-post-v1',
            textFields: [
                {
                    bindingId: 'text',
                    acceptedSourceFormats: ['plain_text'],
                    maxLength: 280,
                    maxGraphemes: 280,
                },
            ],
        },
    }
}

describe('X profile validation adapter', () => {
    it('applies weighted validation while compiling a previously stored v1 profile', () => {
        const compiled = compiler().compile(legacyXProfile())
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        expect(
            compiled.value.validate({
                text: `https://example.com/${'a'.repeat(300)}`,
                media: [],
            }).ok
        ).toBe(true)

        const overLimit = compiled.value.validate({ text: '日'.repeat(200), media: [] })
        expect(overLimit.ok).toBe(false)
        expect(overLimit.issues).toContainEqual(
            expect.objectContaining({
                path: '/text',
                code: 'content.weighted_length',
                source: 'capability',
            })
        )
    })

    it('rejects provider-invalid characters before persistence', () => {
        const compiled = compiler().compile(xChannelProfile)
        expect(compiled.ok).toBe(true)
        if (!compiled.ok) return

        const invalid = compiled.value.validate({ text: 'hello￾world', media: [] })
        expect(invalid.ok).toBe(false)
        expect(invalid.issues).toContainEqual(
            expect.objectContaining({ code: 'content.invalid_characters', path: '/text' })
        )
    })
})
