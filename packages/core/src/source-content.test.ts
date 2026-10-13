import { describe, expect, test } from 'bun:test'

import { validateSourceContent } from './source-content'

describe('source content', () => {
    test('accepts the shared semantic vocabulary without rewriting it', () => {
        const content = {
            body: { text: '  Durable release notes  ', format: 'markdown' as const },
            headline: 'Postbot update',
            language: 'fr-FR',
            media: [{ assetId: 'asset-1', accessibilityText: 'Release dashboard' }],
        }
        const before = structuredClone(content)

        const result = validateSourceContent(content)

        expect(result.ok).toBe(true)
        expect(content).toEqual(before)
        if (result.ok) expect(result.value).toBe(content)
    })

    test('requires body content or media', () => {
        const result = validateSourceContent({ media: [] })

        expect(result.ok).toBe(false)
        expect(result.issues.map(issue => issue.code)).toContain('source.content_required')
    })

    test('rejects blank authoring text and invalid language tags', () => {
        const result = validateSourceContent({
            body: { text: '   ', format: 'plain_text' },
            headline: '\n',
            language: 'not_a_language',
            media: [],
        })

        expect(result.ok).toBe(false)
        expect(result.issues.map(issue => issue.code)).toEqual([
            'source.body_blank',
            'source.headline_blank',
            'source.language_invalid',
        ])
    })

    test('rejects fields outside the fixed source vocabulary', () => {
        const result = validateSourceContent({
            body: { text: 'Hello', format: 'plain_text' },
            media: [],
            visibility: 'public',
        })

        expect(result.ok).toBe(false)
        expect(result.issues).toContainEqual(
            expect.objectContaining({ code: 'schema.additionalProperties', path: '' })
        )
    })

    test('rejects blank media identity and accessibility metadata', () => {
        const result = validateSourceContent({
            media: [{ assetId: '  ', accessibilityText: '\n' }],
        })

        expect(result.ok).toBe(false)
        expect(result.issues.map(issue => issue.code)).toEqual([
            'source.media_asset_id_blank',
            'source.accessibility_text_blank',
        ])
    })
})
