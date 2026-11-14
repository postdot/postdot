import type {
    ChannelProfileDefinition,
    ChannelProfileValidationAdapter,
    ValidationIssue,
} from '@postdot/core'

import {
    DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION,
    DEVTO_EXECUTION_CONTRACT_REVISION,
    DEVTO_MAX_BODY_LENGTH,
    DEVTO_MAX_CANONICAL_URL_LENGTH,
    DEVTO_MAX_DESCRIPTION_LENGTH,
    DEVTO_MAX_IMAGES,
    DEVTO_MAX_SERIES_LENGTH,
    DEVTO_MAX_TAGS,
    DEVTO_MAX_TAG_LENGTH,
    DEVTO_MAX_TITLE_LENGTH,
    DEVTO_PROVIDER,
    devtoAiDisclosureLevels,
    type DevtoAiDisclosureLevel,
} from './contract'

const DEVTO_TAG_PATTERN = new RegExp(`^[a-zA-Z0-9]{1,${DEVTO_MAX_TAG_LENGTH}}$`)

export const devtoArticleV1ChannelProfile: ChannelProfileDefinition = {
    id: DEVTO_PROVIDER,
    version: 1,
    profileHash: 'sha256:postdot-devto-article-v1',
    schemaHash: 'sha256:postdot-devto-article-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                minLength: 1,
                maxLength: DEVTO_MAX_TITLE_LENGTH,
            },
            body_markdown: {
                type: 'string',
                minLength: 1,
                maxLength: DEVTO_MAX_BODY_LENGTH,
            },
            media: {
                type: 'array',
                maxItems: DEVTO_MAX_IMAGES,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string', minLength: 1 },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['title', 'body_markdown', 'media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'title', semantic: 'headline', path: '/title' },
        { id: 'body_markdown', semantic: 'primary_text', path: '/body_markdown' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'devto-article-v1',
        textFields: [
            {
                bindingId: 'title',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: DEVTO_MAX_TITLE_LENGTH,
            },
            {
                bindingId: 'body_markdown',
                acceptedSourceFormats: ['plain_text', 'markdown'],
                maxLength: DEVTO_MAX_BODY_LENGTH,
            },
        ],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: DEVTO_MAX_IMAGES,
                publicUrlRequired: true,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: DEVTO_PROVIDER,
        revision: DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION,
    },
}

const v1ContentSchema = devtoArticleV1ChannelProfile.contentSchema as Readonly<
    Record<string, unknown>
> & { readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>> }

export const devtoChannelProfile: ChannelProfileDefinition = {
    ...devtoArticleV1ChannelProfile,
    version: 2,
    profileHash: 'sha256:postdot-devto-article-v2',
    schemaHash: 'sha256:postdot-devto-article-schema-v2',
    contentSchema: {
        ...v1ContentSchema,
        properties: {
            ...v1ContentSchema.properties,
            tags: {
                type: 'array',
                title: 'Tags',
                description: 'Letters and numbers only, up to 30 characters per tag.',
                maxItems: DEVTO_MAX_TAGS,
                items: {
                    type: 'string',
                    minLength: 1,
                    maxLength: DEVTO_MAX_TAG_LENGTH,
                },
            },
            description: {
                type: 'string',
                title: 'Description',
                description: 'Short summary used for article previews and meta tags.',
                minLength: 1,
                maxLength: DEVTO_MAX_DESCRIPTION_LENGTH,
            },
            series: {
                type: 'string',
                title: 'Series',
                description: 'Name of a DEV.to series to group this article into.',
                minLength: 1,
                maxLength: DEVTO_MAX_SERIES_LENGTH,
            },
            canonical_url: {
                type: 'string',
                title: 'Canonical URL',
                description:
                    'Original HTTP or HTTPS URL if this article was published elsewhere first.',
                minLength: 1,
                maxLength: DEVTO_MAX_CANONICAL_URL_LENGTH,
            },
            ai_disclosure_level: {
                title: 'AI disclosure level',
                description:
                    'Optional AI tooling disclosure sent to DEV.to when explicitly selected.',
                enum: [...devtoAiDisclosureLevels],
            },
            published: {
                type: 'boolean',
                title: 'Publish immediately',
                description:
                    'Set to No to save this article as a draft on DEV.to instead of publishing it live.',
            },
            organization_id: {
                type: 'integer',
                title: 'Organization ID',
                description: 'Numeric DEV.to organization identifier to publish under.',
                minimum: 1,
            },
        },
    },
    fieldBindings: [
        ...devtoArticleV1ChannelProfile.fieldBindings,
        { id: 'tags', semantic: 'tags', path: '/tags' },
    ],
    capabilities: {
        ...devtoArticleV1ChannelProfile.capabilities,
        revision: 'devto-article-v2',
    },
    execution: {
        kind: 'built_in',
        contractId: DEVTO_PROVIDER,
        revision: DEVTO_EXECUTION_CONTRACT_REVISION,
    },
}

export function isDevtoTagValid(tag: string): boolean {
    return DEVTO_TAG_PATTERN.test(tag)
}

export function normalizeDevtoHttpUrl(value: string): string | null {
    if (value.trim().length === 0 || value.length > DEVTO_MAX_CANONICAL_URL_LENGTH) return null
    try {
        const url = new URL(value)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
        if (url.username.length > 0 || url.password.length > 0) return null
        return url.toString()
    } catch {
        return null
    }
}

export function isDevtoAiDisclosureLevel(value: unknown): value is DevtoAiDisclosureLevel {
    return (
        typeof value === 'string' && (devtoAiDisclosureLevels as readonly string[]).includes(value)
    )
}

function capabilityIssue(path: string, code: string, message: string): ValidationIssue {
    return {
        path,
        severity: 'error',
        source: 'capability',
        code,
        message,
    }
}

export const devtoChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: DEVTO_PROVIDER,
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== DEVTO_PROVIDER ||
            !(
                [
                    DEVTO_ARTICLE_V1_EXECUTION_CONTRACT_REVISION,
                    DEVTO_EXECUTION_CONTRACT_REVISION,
                ] as readonly string[]
            ).includes(profile.execution.revision)
        ) {
            return []
        }

        const issues: ValidationIssue[] = []

        if (typeof content.title === 'string' && content.title.trim().length === 0) {
            issues.push(
                capabilityIssue(
                    '/title',
                    'devto.text_blank',
                    'Enter a non-blank DEV.to article title'
                )
            )
        }
        if (
            typeof content.body_markdown === 'string' &&
            content.body_markdown.trim().length === 0
        ) {
            issues.push(
                capabilityIssue(
                    '/body_markdown',
                    'devto.text_blank',
                    'Enter non-blank DEV.to Markdown content'
                )
            )
        }
        if (typeof content.description === 'string' && content.description.trim().length === 0) {
            issues.push(
                capabilityIssue(
                    '/description',
                    'devto.text_blank',
                    'Enter a non-blank description or leave it unset'
                )
            )
        }
        if (typeof content.series === 'string' && content.series.trim().length === 0) {
            issues.push(
                capabilityIssue(
                    '/series',
                    'devto.text_blank',
                    'Enter a non-blank series name or leave it unset'
                )
            )
        }
        if (
            typeof content.canonical_url === 'string' &&
            normalizeDevtoHttpUrl(content.canonical_url) === null
        ) {
            issues.push(
                capabilityIssue(
                    '/canonical_url',
                    'devto.canonical_url_invalid',
                    'Enter an HTTP or HTTPS canonical URL without embedded credentials'
                )
            )
        }
        if (Array.isArray(content.tags)) {
            const seen = new Set<string>()
            for (const [index, tag] of content.tags.entries()) {
                if (typeof tag !== 'string') continue
                if (!isDevtoTagValid(tag)) {
                    issues.push(
                        capabilityIssue(
                            `/tags/${index}`,
                            'devto.tag_invalid',
                            'DEV.to tags must contain 1 to 30 alphanumeric characters'
                        )
                    )
                    continue
                }
                const normalized = tag.toLowerCase()
                if (seen.has(normalized)) {
                    issues.push(
                        capabilityIssue(
                            `/tags/${index}`,
                            'devto.tags_duplicate',
                            'DEV.to tags must be unique'
                        )
                    )
                    continue
                }
                seen.add(normalized)
            }
        }

        return issues
    },
}

export function readDevtoTitleContent(content: Readonly<Record<string, unknown>>): string | null {
    const title = content.title
    return typeof title === 'string' && title.trim().length > 0 ? title : null
}

export function readDevtoBodyContent(content: Readonly<Record<string, unknown>>): string | null {
    const body = content.body_markdown
    return typeof body === 'string' && body.trim().length > 0 ? body : null
}

export type DevtoArticleOptionalContentResult =
    | {
          readonly ok: true
          readonly options: {
              readonly published?: boolean
              readonly tags?: readonly string[]
              readonly canonicalUrl?: string
              readonly description?: string
              readonly series?: string
              readonly aiDisclosureLevel?: DevtoAiDisclosureLevel
              readonly organizationId?: number
          }
      }
    | { readonly ok: false; readonly message: string }

export function readDevtoArticleOptionalContent(
    content: Readonly<Record<string, unknown>>
): DevtoArticleOptionalContentResult {
    let published: boolean | undefined
    if (content.published !== undefined) {
        if (typeof content.published !== 'boolean') {
            return { ok: false, message: 'The DEV.to published flag must be a boolean' }
        }
        published = content.published
    }

    let tags: readonly string[] | undefined
    if (content.tags !== undefined) {
        if (!Array.isArray(content.tags) || content.tags.some(item => typeof item !== 'string')) {
            return { ok: false, message: 'The DEV.to tags list must contain strings only' }
        }
        tags = content.tags as string[]
    }

    let canonicalUrl: string | undefined
    if (content.canonical_url !== undefined) {
        if (typeof content.canonical_url !== 'string') {
            return { ok: false, message: 'The DEV.to canonical URL must be a string' }
        }
        canonicalUrl = content.canonical_url
    }

    let description: string | undefined
    if (content.description !== undefined) {
        if (typeof content.description !== 'string') {
            return { ok: false, message: 'The DEV.to description must be a string' }
        }
        description = content.description
    }

    let series: string | undefined
    if (content.series !== undefined) {
        if (typeof content.series !== 'string') {
            return { ok: false, message: 'The DEV.to series must be a string' }
        }
        series = content.series
    }

    let aiDisclosureLevel: DevtoAiDisclosureLevel | undefined
    if (content.ai_disclosure_level !== undefined) {
        if (!isDevtoAiDisclosureLevel(content.ai_disclosure_level)) {
            return { ok: false, message: 'The DEV.to AI disclosure level is invalid' }
        }
        aiDisclosureLevel = content.ai_disclosure_level
    }

    let organizationId: number | undefined
    if (content.organization_id !== undefined) {
        if (
            typeof content.organization_id !== 'number' ||
            !Number.isSafeInteger(content.organization_id) ||
            content.organization_id < 1
        ) {
            return {
                ok: false,
                message: 'The DEV.to organization ID must be a positive integer',
            }
        }
        organizationId = content.organization_id
    }

    return {
        ok: true,
        options: {
            ...(published === undefined ? {} : { published }),
            ...(tags === undefined ? {} : { tags }),
            ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
            ...(description === undefined ? {} : { description }),
            ...(series === undefined ? {} : { series }),
            ...(aiDisclosureLevel === undefined ? {} : { aiDisclosureLevel }),
            ...(organizationId === undefined ? {} : { organizationId }),
        },
    }
}
