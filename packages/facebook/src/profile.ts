import type { ChannelProfileDefinition, ChannelProfileValidationAdapter } from '@postbot/core'

import { FACEBOOK_MAX_PHOTO_BYTES, isFacebookLink } from './publisher'

export const FACEBOOK_EXECUTION_REVISION = 'page-post-v1'

/** Not registered for channel creation until the connection/execution path is complete. */
export const facebookChannelProfile: ChannelProfileDefinition = {
    id: 'facebook',
    version: 1,
    profileHash: 'sha256:postbot-facebook-page-post-v1',
    schemaHash: 'sha256:postbot-facebook-page-post-schema-v1',
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
        // The endpoint reference does not establish a text ceiling. Do not invent one.
        textFields: [],
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
    execution: { kind: 'built_in', contractId: 'facebook', revision: FACEBOOK_EXECUTION_REVISION },
}

export const facebookChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'facebook',
    validate(profile, content) {
        if (
            profile.execution.kind !== 'built_in' ||
            profile.execution.contractId !== 'facebook' ||
            profile.execution.revision !== FACEBOOK_EXECUTION_REVISION
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
                'Choose a link or a photo for this publication'
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
