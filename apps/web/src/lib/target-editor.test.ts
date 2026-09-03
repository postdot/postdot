import { describe, expect, it } from 'bun:test'

import {
    decodeTargetEnumValue,
    encodeTargetEnumValue,
    getTargetEditorFields,
    readTargetField,
    unsetTargetFieldValue,
    updateTargetField,
} from './target-editor'

describe('schema-aware target editor metadata', () => {
    it('derives controls and constraints from bound channel fields', () => {
        const fields = getTargetEditorFields({
            contentSchema: {
                type: 'object',
                $defs: { tag: { type: 'string', maxLength: 40 } },
                properties: {
                    body: {
                        type: 'string',
                        title: 'Message',
                        description: 'The message sent to the channel.',
                        minLength: 1,
                        maxLength: 500,
                    },
                    visibility: { enum: ['public', 'unlisted'] },
                    notify: { type: 'boolean' },
                    tags: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 5,
                        items: { $ref: '#/$defs/tag' },
                    },
                    metadata: {
                        type: 'object',
                        properties: { source: { type: 'string' } },
                        additionalProperties: false,
                    },
                    settings: { type: 'object', additionalProperties: false },
                    slug: { type: 'string', title: 'External slug', maxLength: 120 },
                    media: {
                        type: 'array',
                        maxItems: 4,
                        items: { type: 'object' },
                    },
                },
                required: ['body', 'visibility'],
                additionalProperties: false,
            },
            fieldBindings: [
                { id: 'body', semantic: 'primary_text', path: '/body' },
                { id: 'visibility', semantic: 'language', path: '/visibility' },
                { id: 'notify', semantic: 'language', path: '/notify' },
                { id: 'tags', semantic: 'tags', path: '/tags' },
                {
                    id: 'media',
                    semantic: 'ordered_media',
                    path: '/media',
                    item: { assetIdPath: '/assetId' },
                },
            ],
            capabilities: {
                textFields: [
                    {
                        bindingId: 'body',
                        acceptedSourceFormats: ['plain_text', 'markdown'],
                        maxLength: 300,
                    },
                ],
                mediaFields: [{ bindingId: 'media', maxItems: 4 }],
            },
        })

        expect(fields).toEqual([
            expect.objectContaining({
                bindingId: 'body',
                label: 'Message',
                kind: 'text',
                required: true,
                minLength: 1,
                maxLength: 300,
                acceptedSourceFormats: ['plain_text', 'markdown'],
            }),
            expect.objectContaining({
                bindingId: 'visibility',
                kind: 'enum',
                required: true,
                enumValues: ['public', 'unlisted'],
            }),
            expect.objectContaining({ bindingId: 'notify', kind: 'boolean', required: false }),
            expect.objectContaining({
                bindingId: 'tags',
                kind: 'string-list',
                minItems: 1,
                maxItems: 5,
                maxLength: 40,
            }),
            expect.objectContaining({
                bindingId: 'schema:/metadata/source',
                path: '/metadata/source',
                kind: 'text',
            }),
            expect.objectContaining({ bindingId: 'schema:/settings', kind: 'unsupported' }),
            expect.objectContaining({
                bindingId: 'schema:/slug',
                label: 'External slug',
                kind: 'text',
                maxLength: 120,
            }),
            expect.objectContaining({ bindingId: 'media', kind: 'media', maxItems: 4 }),
        ])
    })

    it('projects schema fields even when a profile has no bindings', () => {
        const fields = getTargetEditorFields({
            contentSchema: {
                type: 'object',
                properties: { slug: { type: 'string' }, enabled: { type: 'boolean' } },
            },
        })

        expect(fields).toEqual([
            expect.objectContaining({ bindingId: 'schema:/slug', kind: 'text' }),
            expect.objectContaining({ bindingId: 'schema:/enabled', kind: 'boolean' }),
        ])
    })

    it('resolves local schema references before classifying a field', () => {
        const fields = getTargetEditorFields({
            contentSchema: {
                type: 'object',
                $defs: {
                    message: { type: 'string', maxLength: 300 },
                },
                properties: { body: { $ref: '#/$defs/message' } },
                required: ['body'],
                additionalProperties: false,
            },
            fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
            capabilities: { textFields: [], mediaFields: [] },
        })

        expect(fields[0]).toEqual(
            expect.objectContaining({ kind: 'text', required: true, maxLength: 300 })
        )
    })

    it('falls back to Advanced JSON for ambiguous composed schemas', () => {
        const fields = getTargetEditorFields({
            contentSchema: {
                type: 'object',
                properties: {
                    body: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                },
            },
            fieldBindings: [{ id: 'body', semantic: 'primary_text', path: '/body' }],
        })

        expect(fields[0]).toEqual(
            expect.objectContaining({ bindingId: 'body', kind: 'unsupported' })
        )
    })
})

describe('schema-aware target editor values', () => {
    it('updates nested JSON Pointer values without dropping provider fields', () => {
        const target = {
            payload: { message: 'Before', keep: true },
            provider: { mode: 'safe' },
        }

        const updated = updateTargetField(target, '/payload/message', 'After')

        expect(updated).toEqual({
            payload: { message: 'After', keep: true },
            provider: { mode: 'safe' },
        })
        expect(target.payload.message).toBe('Before')
        expect(readTargetField(updated, '/payload/message')).toBe('After')
    })

    it('deletes an optional field and handles escaped pointer segments', () => {
        const target = { 'provider/name': { label: 'Custom' }, optional: 'remove' }

        const updated = updateTargetField(target, '/optional', undefined)
        const escaped = updateTargetField(updated, '/provider~1name/label', 'Updated')

        expect(escaped).toEqual({ 'provider/name': { label: 'Updated' } })
        expect(readTargetField(escaped, '/provider~1name/label')).toBe('Updated')
    })

    it('round-trips primitive enum values and rejects values outside the schema', () => {
        const values = ['public', false, 3, null] as const

        for (const value of values) {
            const encoded = encodeTargetEnumValue(value)
            expect(decodeTargetEnumValue(encoded, values)).toEqual(value)
        }

        expect(decodeTargetEnumValue(unsetTargetFieldValue, values)).toBeUndefined()
        expect(decodeTargetEnumValue(JSON.stringify('private'), values)).toBeUndefined()
    })
})
