import { describe, expect, test } from 'bun:test'

import type { ChannelProfilePreset } from '@/lib/api'
import {
    builtInChannelProfileTemplatePrefix,
    channelProfileTemplates,
    profileForTemplate,
    templatesFromPresets,
} from '@/lib/channel-profile-presets'

describe('channel profile templates', () => {
    test('provide valid JSON-compatible starter profiles', () => {
        expect(channelProfileTemplates.map(template => template.id)).toEqual([
            'custom-manual',
            'custom-webhook',
        ])

        for (const template of channelProfileTemplates) {
            expect(() => JSON.stringify(template.profile)).not.toThrow()
            expect(template.profile.origin).toBe('custom')
            expect(template.profile.contentSchema).toMatchObject({ type: 'object' })
            expect(template.profile.fieldBindings).toEqual(expect.any(Array))
            const capabilities = template.profile.capabilities as {
                textFields?: unknown
                mediaFields?: unknown
            }
            expect(Array.isArray(capabilities.textFields)).toBe(true)
            expect(Array.isArray(capabilities.mediaFields)).toBe(true)
        }
    })

    test('distinguishes manual and declarative HTTP execution', () => {
        expect(channelProfileTemplates[0]?.profile.execution).toEqual({ kind: 'manual' })
        expect(channelProfileTemplates[1]?.profile.execution).toMatchObject({
            kind: 'declarative_http',
            mode: 'herald_webhook',
        })
    })

    test('turns built-in profiles into independent editable custom starters', () => {
        const source: ChannelProfilePreset = {
            id: 'bluesky',
            version: 1,
            profile: {
                id: 'bluesky',
                version: 1,
                profileHash: 'sha256:bluesky-profile-v1',
                schemaHash: 'sha256:bluesky-schema-v1',
                origin: 'built_in',
                contentSchema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        media: {
                            type: 'array',
                            maxItems: 4,
                            items: {
                                type: 'object',
                                properties: {
                                    assetId: { type: 'string', minLength: 1 },
                                },
                                required: ['assetId'],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ['text', 'media'],
                    additionalProperties: false,
                },
                fieldBindings: [{ id: 'text', semantic: 'primary_text', path: '/text' }],
                capabilities: {
                    revision: 'bluesky-v1',
                    textFields: [],
                    mediaFields: [],
                    relations: [],
                },
                execution: {
                    kind: 'built_in',
                    contractId: 'bluesky',
                    revision: 'bluesky@post-v1',
                },
            },
        }

        const [template] = templatesFromPresets([source])
        expect(template?.id).toBe(`${builtInChannelProfileTemplatePrefix}bluesky`)
        expect(template?.profile).toMatchObject({
            id: 'custom-bluesky',
            version: 1,
            origin: 'custom',
            schemaHash: 'sha256:herald-custom-bluesky-schema-v1',
            execution: source.profile.execution,
        })
        expect(template?.profile).not.toBe(source.profile)
        expect(template?.profile.contentSchema).not.toBe(source.profile.contentSchema)
        expect(template?.profile.contentSchema).toMatchObject({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            properties: {
                media: {
                    items: {
                        properties: {
                            assetId: { maxLength: 255 },
                        },
                    },
                },
            },
        })
        expect(profileForTemplate(template?.id ?? '', [template!])).toBe(template?.profile)

        expect(
            templatesFromPresets([
                {
                    ...source,
                    id: 'manual-message',
                    profile: { ...source.profile, id: 'manual-message' },
                },
            ])
        ).toEqual([])
    })
})
