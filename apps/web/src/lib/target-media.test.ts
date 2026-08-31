import { describe, expect, it } from 'bun:test'

import { updateTargetMedia } from './target-media'

describe('target media updates', () => {
    it('maps selected assets into every ordered-media binding without changing other target fields', () => {
        const profile = {
            fieldBindings: [
                {
                    semantic: 'ordered_media',
                    path: '/payload/media',
                    item: {
                        assetIdPath: '/assetId',
                        accessibilityTextPath: '/accessibilityText',
                    },
                },
            ],
        }
        const target = {
            commentary: 'Keep this adaptation',
            payload: { media: [{ assetId: 'old-asset' }], preserve: true },
        }

        const updated = updateTargetMedia(profile, target, [
            { assetId: 'asset-1', accessibilityText: 'First image' },
            { assetId: 'asset-2' },
        ])

        expect(updated).toEqual({
            commentary: 'Keep this adaptation',
            payload: {
                media: [
                    { assetId: 'asset-1', accessibilityText: 'First image' },
                    { assetId: 'asset-2' },
                ],
                preserve: true,
            },
        })
        expect(target).toEqual({
            commentary: 'Keep this adaptation',
            payload: { media: [{ assetId: 'old-asset' }], preserve: true },
        })
    })

    it('preserves provider-specific fields for media that remains selected', () => {
        const profile = {
            fieldBindings: [
                {
                    semantic: 'ordered_media',
                    path: '/media',
                    item: {
                        assetIdPath: '/assetId',
                        accessibilityTextPath: '/accessibilityText',
                    },
                },
            ],
        }
        const target = {
            media: [
                {
                    assetId: 'asset-1',
                    accessibilityText: 'Old description',
                    crop: { x: 0.25, y: 0.5 },
                },
                { assetId: 'removed-asset', crop: { x: 0.8, y: 0.2 } },
            ],
        }

        expect(
            updateTargetMedia(profile, target, [
                { assetId: 'asset-1', accessibilityText: 'Updated description' },
                { assetId: 'asset-2' },
            ])
        ).toEqual({
            media: [
                {
                    assetId: 'asset-1',
                    accessibilityText: 'Updated description',
                    crop: { x: 0.25, y: 0.5 },
                },
                { assetId: 'asset-2' },
            ],
        })
    })

    it('leaves targets unchanged when the runtime profile has no usable media binding', () => {
        const target = { body: 'Manual copy' }

        expect(updateTargetMedia({ fieldBindings: [] }, target, [])).toEqual(target)
        expect(
            updateTargetMedia({ fieldBindings: [{ semantic: 'primary_text' }] }, target, [])
        ).toEqual(target)
    })
})
