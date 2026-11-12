import type { ChannelProfileDefinition, ChannelProfileValidationAdapter } from '@postdot/core'

import { FACEBOOK_MAX_PHOTOS, FACEBOOK_MAX_PHOTO_BYTES, isFacebookLink } from './publisher'

export const FACEBOOK_IMAGE_EXECUTION_REVISION = 'page-post-v1'
export const FACEBOOK_EXECUTION_REVISION = 'page-post-v2'

/** Native Page text, link or a single inspected photo. */
export const facebookImageChannelProfile: ChannelProfileDefinition = {
    id: 'facebook',
    version: 1,
    profileHash: 'sha256:postdot-facebook-page-post-v1',
    schemaHash: 'sha256:postdot-facebook-page-post-schema-v1',
    origin: 'built_in',
    contentSchema: {
        type: 'object',
        properties: {
            text: { type: 'string' },
            link: { type: 'string', title: 'Link' },
            media: {
                type: 'array',
                maxItems: 1,
                items: {
                    type: 'object',
                    properties: {
                        assetId: { type: 'string', minLength: 1 },
                        accessibilityText: { type: 'string' },
                    },
                    required: ['assetId'],
                    additionalProperties: false,
                },
            },
        },
        required: ['media'],
        additionalProperties: false,
    },
    fieldBindings: [
        { id: 'text', semantic: 'primary_text', path: '/text' },
        {
            id: 'media',
            semantic: 'ordered_media',
            path: '/media',
            item: { assetIdPath: '/assetId', accessibilityTextPath: '/accessibilityText' },
        },
    ],
    capabilities: {
        revision: 'facebook-page-post-v1',
        textFields: [{ bindingId: 'text', acceptedSourceFormats: ['plain_text'], maxLength: null }],
        mediaFields: [
            {
                bindingId: 'media',
                families: ['image'],
                mimeTypes: ['image/jpeg', 'image/png'],
                maxItems: 1,
                maxBytesPerItem: FACEBOOK_MAX_PHOTO_BYTES,
                accessibilityTextRequired: false,
                allowMixedFamilies: false,
            },
        ],
        relations: [],
    },
    execution: {
        kind: 'built_in',
        contractId: 'facebook',
        revision: FACEBOOK_IMAGE_EXECUTION_REVISION,
    },
}

const imageSchema = facebookImageChannelProfile.contentSchema as Readonly<
    Record<string, unknown>
> & { readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>> }

/** Ten photos is an application envelope, not a claim about the provider maximum. */
export const facebookChannelProfile: ChannelProfileDefinition = {
    ...facebookImageChannelProfile,
    version: 2,
    profileHash: 'sha256:postdot-facebook-page-post-v2',
    schemaHash: 'sha256:postdot-facebook-page-post-schema-v2',
    contentSchema: {
        ...facebookImageChannelProfile.contentSchema,
        properties: {
            ...imageSchema.properties,
            media: { ...imageSchema.properties.media, maxItems: FACEBOOK_MAX_PHOTOS },
        },
    },
    capabilities: {
        ...facebookImageChannelProfile.capabilities,
        revision: 'facebook-page-post-v2',
        mediaFields: facebookImageChannelProfile.capabilities.mediaFields.map(field => ({
            ...field,
            maxItems: FACEBOOK_MAX_PHOTOS,
        })),
    },
    execution: { kind: 'built_in', contractId: 'facebook', revision: FACEBOOK_EXECUTION_REVISION },
}

export const facebookChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'facebook',
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== 'facebook' ||
            ![FACEBOOK_IMAGE_EXECUTION_REVISION, FACEBOOK_EXECUTION_REVISION].includes(
                profile.execution.revision
            )
        )
            return []
        // Structural errors belong to the schema validator.
        if (
            !Array.isArray(content.media) ||
            (content.text !== undefined && typeof content.text !== 'string') ||
            (content.link !== undefined && typeof content.link !== 'string')
        )
            return []
        const link = content.link === '' ? undefined : content.link
        const issue = (path: string, code: string, message: string) => [
            {
                path,
                severity: 'error' as const,
                source: 'capability' as const,
                code,
                message,
            },
        ]
        if (link !== undefined && !isFacebookLink(link))
            return issue(
                '/link',
                'facebook.link_invalid',
                'Enter an HTTP or HTTPS link without embedded credentials'
            )
        if (content.media.length > 0 && link !== undefined)
            return issue(
                '/link',
                'facebook.link_photo_combination',
                'Choose a link or photos for this publication'
            )
        if (content.media.length === 0 && link === undefined && !(content.text ?? '').trim())
            return issue(
                '/text',
                'facebook.content_required',
                'Enter text, add a link or attach a photo'
            )
        return []
    },
}
