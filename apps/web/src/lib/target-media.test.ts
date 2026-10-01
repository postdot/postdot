import { describe, expect, it } from 'bun:test'

import {
    mediaSelectionsEqual,
    reorderMediaSelections,
    toggleMediaSelection,
    updateTargetMedia,
} from './target-media'

describe('media selection helpers', () => {
    it('toggles an asset without mutating the current selection or changing order', () => {
        const current = [{ assetId: 'asset-1' }, { assetId: 'asset-2' }]

        expect(toggleMediaSelection(current, { assetId: 'asset-3' })).toEqual([
            { assetId: 'asset-1' },
            { assetId: 'asset-2' },
            { assetId: 'asset-3' },
        ])
        expect(toggleMediaSelection(current, { assetId: 'asset-1' })).toEqual([
            { assetId: 'asset-2' },
        ])
        expect(current).toEqual([{ assetId: 'asset-1' }, { assetId: 'asset-2' }])
    })

    it('compares ordered selections including accessibility text', () => {
        const selection = [{ assetId: 'asset-1', accessibilityText: 'A room' }]

        expect(mediaSelectionsEqual(selection, [{ ...selection[0]! }])).toBe(true)
        expect(mediaSelectionsEqual(selection, [{ assetId: 'asset-1' }])).toBe(false)
        expect(
            mediaSelectionsEqual(selection, [{ assetId: 'asset-2', accessibilityText: 'A room' }])
        ).toBe(false)
        expect(mediaSelectionsEqual(selection, [])).toBe(false)
    })

    it('reorders existing attachments without duplicating or losing accessibility text', () => {
        const current = [
            { assetId: 'asset-1', accessibilityText: 'First image' },
            { assetId: 'asset-2' },
        ]
        expect(reorderMediaSelections(current, ['asset-2', 'asset-1'])).toEqual([
            { assetId: 'asset-2' },
            { assetId: 'asset-1', accessibilityText: 'First image' },
        ])
        expect(reorderMediaSelections(current, ['asset-1', 'asset-1'])).toEqual(current)
        expect(reorderMediaSelections(current, ['asset-2', 'unknown'])).toEqual(current)
    })
})

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
