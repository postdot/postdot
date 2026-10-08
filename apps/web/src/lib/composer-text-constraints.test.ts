import { expect, test } from 'bun:test'

import { createManualChannelProfile } from '@herald/core'

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
