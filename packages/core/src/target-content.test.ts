import { describe, expect, it } from 'bun:test'

import {
    createManualChannelProfile,
    adaptSourceContentToProfile,
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

    it('validates target content without changing the caller value', () => {
        const profile = createManualChannelProfile()
        const content = { body: 'A valid message', media: [] }

        const result = validateTargetContent(profile, content)

        expect(result).toMatchObject({ ok: true, value: content })
        expect(content).toEqual({ body: 'A valid message', media: [] })
        expect(validateTargetContent(profile, { body: '', media: [] })).toMatchObject({ ok: false })
    })
})
