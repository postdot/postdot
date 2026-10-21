import { expect, test } from 'bun:test'

import { createManualChannelProfile } from '@postdot/core'

import { countComposerText, getComposerTextFields } from './composer-text-constraints'

test('resolves nested headline and body semantics rather than names or paths', () => {
    const profile = createManualChannelProfile()
    const { $schema, ...inner } = profile.contentSchema as Readonly<Record<string, unknown>>
    const fields = getComposerTextFields({
        ...profile,
        contentSchema: {
            $schema,
            type: 'object',
            properties: { article: inner },
            required: ['article'],
            additionalProperties: false,
        },
        fieldBindings: profile.fieldBindings.map(binding => ({
            ...binding,
            path: '/article' + binding.path,
        })),
    })
    expect(fields.headline?.field.path).toBe('/article/headline')
    expect(fields.body?.field.path).toBe('/article/body')
})

test('distinguishes schema characters from graphemes without shortening the input', () => {
    const profile = createManualChannelProfile()
    const body = getComposerTextFields({
        ...profile,
        capabilities: {
            ...profile.capabilities,
            textFields: profile.capabilities.textFields.map(field =>
                field.bindingId === 'body' ? { ...field, maxGraphemes: 1 } : field
            ),
        },
    }).body!
    expect(countComposerText('👩‍💻', body)).toEqual({ characters: 3, graphemes: 1, invalid: false })
    expect(countComposerText('👩‍💻a', body)).toEqual({ characters: 4, graphemes: 2, invalid: true })
    expect(countComposerText('', body).invalid).toBe(false)
})

test('composer exposes optional and required titles but no title for an absent binding', async () => {
    const { setBuilderTitleMode } = await import('./channel-content-builder')
    const { xChannelProfile } = await import('@postdot/x')
    const manual = createManualChannelProfile()
    const custom = { ...manual, origin: 'custom' as const }
    expect(getComposerTextFields(custom).headline?.field.required).toBe(false)
    const absent = setBuilderTitleMode(custom, 'absent')
    expect(absent.ok).toBe(true)
    if (!absent.ok) throw new Error(absent.reason)
    expect(getComposerTextFields(absent.profile as unknown as typeof manual).headline).toBeNull()
    const required = setBuilderTitleMode(absent.profile, 'required')
    expect(required.ok).toBe(true)
    if (!required.ok) throw new Error(required.reason)
    expect(
        getComposerTextFields(required.profile as unknown as typeof manual).headline?.field.required
    ).toBe(true)
    expect(getComposerTextFields(xChannelProfile).headline).toBeNull()
})

test('preview constraint lookup tolerates incomplete draft definitions', () => {
    expect(getComposerTextFields(null)).toEqual({ headline: null, body: null })
    const profile = createManualChannelProfile()
    const incomplete = {
        ...profile,
        capabilities: { textFields: [null, { bindingId: 'body', maxGraphemes: 'invalid' }] },
    }
    const body = getComposerTextFields(incomplete).body!
    expect(body.field.path).toBe('/body')
    expect(body.maxGraphemes).toBeNull()
    expect(countComposerText('👩‍💻', body).characters).toBe(3)
})

test('an explicitly unknown native text maximum produces a count without an invented ceiling', () => {
    const profile = {
        contentSchema: { type: 'object', properties: { text: { type: 'string' } } },
        fieldBindings: [{ id: 'text', semantic: 'primary_text', path: '/text' }],
        capabilities: {
            textFields: [
                { bindingId: 'text', acceptedSourceFormats: ['plain_text'], maxLength: null },
            ],
        },
    }
    const fields = getComposerTextFields(profile)
    expect(fields.body?.field.maxLength).toBeNull()
    expect(countComposerText('a'.repeat(70_000), fields.body!)).toEqual({
        characters: 70_000,
        graphemes: null,
        invalid: false,
    })
    const known = {
        ...profile,
        capabilities: { textFields: [{ ...profile.capabilities.textFields[0], maxLength: 280 }] },
    }
    expect(countComposerText('a'.repeat(281), getComposerTextFields(known).body!).invalid).toBe(
        true
    )
})
