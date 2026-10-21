import { describe, expect, it } from 'bun:test'

import { createManualChannelProfile } from '@postdot/core'

import * as m from '@/paraglide/messages.js'

import {
    decodeTargetEnumValue,
    encodeTargetEnumValue,
    getTargetEditorFields,
    getTargetEditorProfile,
    readTargetField,
    unsetTargetFieldValue,
    updateTargetField,
} from './target-editor'

describe('schema-aware target editor metadata', () => {
    it('localizes only built-in field labels and preserves explicit schema titles', () => {
        const profile = createManualChannelProfile()
        const french = getTargetEditorFields(profile, 'fr')
        expect(french.map(field => field.label)).toEqual([
            m.profile_field_body({}, { locale: 'fr' }),
            m.profile_field_headline({}, { locale: 'fr' }),
            m.profile_field_language({}, { locale: 'fr' }),
            m.profile_field_media({}, { locale: 'fr' }),
        ])
        expect(getTargetEditorFields(profile, 'en').map(field => field.label)).toEqual([
            'Body',
            'Headline',
            'Language',
            'Media',
        ])
        const custom = { ...profile, origin: 'custom' }
        expect(getTargetEditorFields(custom, 'fr').map(field => field.label)).toEqual([
            'Body',
            'Headline',
            'Language',
            'Media',
        ])
        const titled = {
            ...profile,
            contentSchema: {
                type: 'object',
                properties: { body: { type: 'string', title: 'Editorial copy' } },
            },
        }
        expect(getTargetEditorFields(titled, 'fr')[0]?.label).toBe('Editorial copy')
        expect(profile.fieldBindings[0]?.path).toBe('/body')
    })

    it('uses weighted counting for X instead of the legacy raw-length constraint', () => {
        const fields = getTargetEditorFields({
            execution: { kind: 'built_in', contractId: 'x', revision: 'post-v1' },
            contentSchema: {
                type: 'object',
                properties: { text: { type: 'string', minLength: 1, maxLength: 280 } },
                required: ['text'],
            },
            fieldBindings: [{ id: 'text', semantic: 'primary_text', path: '/text' }],
            capabilities: {
                textFields: [
                    {
                        bindingId: 'text',
                        acceptedSourceFormats: ['plain_text'],
                        maxLength: 280,
                        maxGraphemes: 280,
                    },
                ],
                mediaFields: [],
            },
        })

        expect(fields[0]).toEqual(
            expect.objectContaining({
                bindingId: 'text',
                maxLength: null,
                maxWeightedLength: 280,
                weightedLengthAlgorithm: 'twitter-text-v3',
            })
        )
    })

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

describe('execution-aware target field dialect', () => {
    it('keeps native tools for renamed profiles and generic controls for matching manual IDs', () => {
        for (const id of ['discord', 'devto', 'renamed']) {
            expect(
                getTargetEditorProfile({
                    id,
                    execution: { kind: 'built_in', contractId: 'discord' },
                })
            ).toBe('discord')
            expect(
                getTargetEditorProfile({ id, execution: { kind: 'built_in', contractId: 'devto' } })
            ).toBe('article')
            expect(getTargetEditorProfile({ id, execution: { kind: 'manual' } })).toBeUndefined()
        }
    })
    it('does not grant a dialect from invalid shape, source formats or unknown execution', () => {
        for (const profile of [
            null,
            [],
            {},
            { id: 'discord' },
            { execution: 'discord' },
            { acceptedSourceFormats: ['markdown'] },
            { execution: { kind: 'built_in', contractId: 1 } },
            { execution: { kind: 'built_in', contractId: 'unknown' } },
            { execution: { kind: 'declarative_http' } },
        ]) {
            expect(getTargetEditorProfile(profile)).toBeUndefined()
        }
    })
})
