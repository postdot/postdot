import { describe, expect, test } from 'bun:test'

import { markdownCodec, plainDocument, plainText, requiresSourceMode } from './configuration'

describe('experimental editor publishing formats', () => {
    test('preserves plain text whitespace, delimiters and Unicode without interpreting syntax', () => {
        for (const text of [
            '',
            '\n\n',
            '  **literal**\n\n😀 café\n',
            'https://example.com/?a=1&b=2',
        ]) {
            expect(plainText(plainDocument(text))).toBe(text)
        }
    })

    test('uses Discord underline and spoiler delimiters rather than generic Markdown', () => {
        const codec = markdownCodec('discord')
        const document = codec.parse('__underlined__ and ||spoiler|| and **bold**')
        expect(JSON.stringify(document)).toContain('discordUnderline')
        expect(JSON.stringify(document)).toContain('discordSpoiler')
        const output = codec.serialize(document)
        expect(output).toContain('__underlined__')
        expect(output).toContain('||spoiler||')
        expect(codec.parse(output)).toEqual(document)
    })

    test('keeps unsupported imported content in source mode', () => {
        expect(requiresSourceMode('article', '![Photo](https://example.com/image.png)')).toBe(true)
        expect(requiresSourceMode('article', '<strong>HTML</strong>')).toBe(true)
        expect(requiresSourceMode('discord', '## Title')).toBe(true)
        expect(requiresSourceMode('discord', '[Link](https://example.com)')).toBe(true)
        expect(requiresSourceMode('article', '## Title')).toBe(false)
        expect(requiresSourceMode('plain', '**literal**')).toBe(false)
    })

    test('isolates the dialects even after several manager instances', () => {
        const article = markdownCodec('article')
        markdownCodec('discord')
        markdownCodec('discord')
        expect(JSON.stringify(article.parse('__bold__'))).toContain('bold')
        expect(JSON.stringify(article.parse('__bold__'))).not.toContain('discordUnderline')
        expect(article.serialize(article.parse('||literal||'))).toContain('||literal||')
    })

    test('preserves supported article structures through repeated conversions', () => {
        const codec = markdownCodec('article')
        const document = codec.parse(
            '## Title\n\n- One\n- Two\n\n> Quote\n\n```js\nconst x = 1\n```\n\n[Link](https://example.com)'
        )
        const output = codec.serialize(document)
        expect(codec.parse(output)).toEqual(document)
        expect(output).toContain('## Title')
        expect(output).toContain('https://example.com')
    })
})
