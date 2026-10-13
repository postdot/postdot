import type { ChannelProfilePreset, RuntimeChannelProfile } from '@/lib/api'

export interface ChannelProfileTemplate {
    readonly id: string
    readonly profile: RuntimeChannelProfile
}

export const builtInChannelProfileTemplatePrefix = 'builtin:'

const jsonSchema202012Dialect = 'https://json-schema.org/draft/2020-12/schema'
const customStringMaximum = 10_000
const customAssetIdMaximum = 255

const sharedContentSchema = {
    $schema: jsonSchema202012Dialect,
    type: 'object',
    properties: {
        body: { type: 'string', minLength: 1, maxLength: 1_000_000 },
        headline: { type: 'string', minLength: 1, maxLength: 10_000 },
        language: { type: 'string', minLength: 2, maxLength: 35 },
        media: {
            type: 'array',
            maxItems: 256,
            items: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', minLength: 1, maxLength: 255 },
                    accessibilityText: { type: 'string', minLength: 1, maxLength: 10_000 },
                },
                required: ['assetId'],
                additionalProperties: false,
            },
        },
    },
    required: ['body'],
    additionalProperties: false,
}

const sharedFieldBindings = [
    { id: 'body', semantic: 'primary_text', path: '/body' },
    { id: 'headline', semantic: 'headline', path: '/headline' },
    { id: 'language', semantic: 'language', path: '/language' },
    {
        id: 'media',
        semantic: 'ordered_media',
        path: '/media',
        item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
    },
]

const sharedCapabilities = {
    revision: 'postbot-custom-v1',
    textFields: [
        {
            bindingId: 'body',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 1_000_000,
        },
        {
            bindingId: 'headline',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 10_000,
        },
        {
            bindingId: 'language',
            acceptedSourceFormats: ['plain_text', 'markdown'],
            maxLength: 35,
        },
    ],
    mediaFields: [
        {
            bindingId: 'media',
            families: ['image', 'video', 'audio', 'document'],
            mimeTypes: ['image/*', 'video/*', 'audio/*', 'application/*'],
            maxItems: 256,
        },
    ],
    relations: [],
}

function createCustomProfile(
    id: string,
    execution: Record<string, unknown>
): RuntimeChannelProfile {
    return {
        id,
        version: 1,
        profileHash: `sha256:postbot-${id}-v1`,
        schemaHash: 'sha256:postbot-custom-content-v1',
        origin: 'custom',
        contentSchema: sharedContentSchema,
        fieldBindings: sharedFieldBindings,
        capabilities: sharedCapabilities,
        execution,
    }
}

export const channelProfileTemplates: readonly ChannelProfileTemplate[] = [
    {
        id: 'custom-manual',
        profile: createCustomProfile('custom-manual', { kind: 'manual' }),
    },
    {
        id: 'custom-webhook',
        profile: createCustomProfile('custom-webhook', {
            kind: 'declarative_http',
            contractId: 'custom-webhook',
            revision: 'v1',
            mode: 'postbot_webhook',
        }),
    },
]

/**
 * Turn server-owned built-in profiles into editable custom starters. The
 * snapshot keeps the provider's content contract and execution identity, but
 * receives a custom identity before it is submitted as a channel profile.
 */
export function templatesFromPresets(
    presets: readonly ChannelProfilePreset[]
): readonly ChannelProfileTemplate[] {
    return presets
        .filter(preset => preset.id !== 'manual-message' && preset.profile.origin === 'built_in')
        .map(preset => {
            const profile = structuredClone(preset.profile)
            return {
                id: `${builtInChannelProfileTemplatePrefix}${preset.id}`,
                profile: {
                    ...profile,
                    id: `custom-${preset.id}`,
                    profileHash: `sha256:postbot-custom-${preset.id}-v${preset.version}`,
                    schemaHash: `sha256:postbot-custom-${preset.id}-schema-v${preset.version}`,
                    origin: 'custom',
                    contentSchema: prepareCustomContentSchema(profile.contentSchema),
                },
            }
        })
}

function prepareCustomContentSchema(value: unknown, path: readonly string[] = []): unknown {
    if (Array.isArray(value)) {
        return value.map((item, index) =>
            prepareCustomContentSchema(item, [...path, String(index)])
        )
    }
    if (value === null || typeof value !== 'object') return value

    const record = value as Record<string, unknown>
    const prepared = Object.fromEntries(
        Object.entries(record).map(([key, child]) => [
            key,
            prepareCustomContentSchema(child, [...path, key]),
        ])
    )

    if (path.length === 0 && prepared.$schema === undefined) {
        prepared.$schema = jsonSchema202012Dialect
    }
    if (prepared.type === 'string' && prepared.maxLength === undefined) {
        prepared.maxLength = path.at(-1) === 'assetId' ? customAssetIdMaximum : customStringMaximum
    }

    return prepared
}

export function profileForTemplate(
    templateId: string,
    templates: readonly ChannelProfileTemplate[] = channelProfileTemplates
): RuntimeChannelProfile | undefined {
    return templates.find(template => template.id === templateId)?.profile
}
