import { describe, expect, it } from 'bun:test'

import {
    createManualChannelProfile,
    adaptSourceContentToProfile,
    applySourceContentToTarget,
    extractTargetMediaReferences,
    validateTargetContent,
} from './index'

describe('target content', () => {
    it('adapts shared source semantics into a channel profile', () => {
        const target = adaptSourceContentToProfile(
            {
                body: { text: 'A channel-ready message', format: 'markdown' },
                headline: 'A headline',
                language: 'en-US',
                media: [{ assetId: 'asset-1', accessibilityText: 'A preview' }],
            },
            createManualChannelProfile()
        )

        expect(target).toEqual({
            body: 'A channel-ready message',
            headline: 'A headline',
            language: 'en-US',
            media: [{ assetId: 'asset-1', accessibilityText: 'A preview' }],
        })
    })

    it('replaces declared source copy without discarding destination-specific fields', () => {
        const original = {
            body: 'Adapted',
            headline: 'Adapted title',
            media: [{ assetId: 'old' }],
            language: 'fr',
            tags: ['local'],
        }
        const profile = createManualChannelProfile()
        const applied = applySourceContentToTarget(
            { body: { text: 'New source', format: 'plain_text' }, media: [] },
            profile,
            original
        )
        expect(applied).toEqual({ body: 'New source', media: [], language: 'fr', tags: ['local'] })
        expect(original.body).toBe('Adapted')
        expect(original.headline).toBe('Adapted title')
        const nested = {
            ...profile,
            fieldBindings: profile.fieldBindings.map(binding =>
                binding.semantic === 'primary_text'
                    ? { ...binding, path: '/article/body' }
                    : binding
            ),
        }
        expect(
            applySourceContentToTarget(
                { body: { text: 'Nested source', format: 'plain_text' }, media: [] },
                nested,
                { article: { body: 'Old', caption: 'Keep me' }, language: 'fr' }
            )
        ).toEqual({
            article: { body: 'Nested source', caption: 'Keep me' },
            media: [],
            language: 'fr',
        })
    })

    it('validates target content without changing the caller value', () => {
        const profile = createManualChannelProfile()
        const content = { body: 'A valid message', media: [] }

        const result = validateTargetContent(profile, content)

        expect(result).toMatchObject({ ok: true, value: content })
        expect(content).toEqual({ body: 'A valid message', media: [] })
        expect(validateTargetContent(profile, { body: '', media: [] })).toMatchObject({ ok: false })
    })

    it('extracts ordered media references with stable item paths', () => {
        const references = extractTargetMediaReferences(createManualChannelProfile(), {
            body: 'A message',
            media: [
                { assetId: 'asset-1', accessibilityText: 'First image' },
                { assetId: 'asset-2' },
            ],
        })

        expect(references).toEqual([
            {
                bindingId: 'media',
                itemIndex: 0,
                contentPath: '/media/0',
                assetId: 'asset-1',
                accessibilityText: 'First image',
                role: null,
            },
            {
                bindingId: 'media',
                itemIndex: 1,
                contentPath: '/media/1',
                assetId: 'asset-2',
                accessibilityText: null,
                role: null,
            },
        ])
    })
})
