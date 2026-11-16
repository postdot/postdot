import { describe, expect, test } from 'bun:test'

import { diffWords, type WordDiffPart } from './word-diff'

const changed = (parts: readonly WordDiffPart[]) =>
    parts.filter(part => part.changed).map(part => part.text)

describe('word comparison', () => {
    test('marks only replaced words and keeps the common sentence', () => {
        const diff = diffWords('The quiet channel is ready.', 'The calm channel is ready.')
        expect(changed(diff.current)).toEqual(['quiet'])
        expect(changed(diff.post)).toEqual(['calm'])
    })

    test('handles insertion, removal, identical and empty text', () => {
        expect(changed(diffWords('One two', 'One new two').post)).toEqual(['new '])
        expect(changed(diffWords('One old two', 'One two').current)).toEqual(['old '])
        expect(diffWords('', '')).toEqual({ current: [], post: [] })
        expect(changed(diffWords('', 'New title').post)).toEqual(['New title'])
        expect(changed(diffWords('Old title', '').current)).toEqual(['Old title'])
        expect(changed(diffWords('Same text', 'Same text').current)).toEqual([])
    })

    test('preserves whitespace, punctuation, repeated words and localized characters', () => {
        for (const [current, post] of [
            ['  Bonjour\tHello!\n\nEnd. ', '  Bonjour\tGoodbye!\nEnd. '],
            ['one two one three', 'one three one two'],
            ['Für Sie: café ready.', 'Für Sie: café later.'],
            ['a b c d', 'c d a b'],
        ] as const) {
            const diff = diffWords(current, post)
            expect(diff.current.map(part => part.text).join('')).toBe(current)
            expect(diff.post.map(part => part.text).join('')).toBe(post)
            expect(
                diff.current
                    .filter(part => !part.changed)
                    .map(part => part.text)
                    .join('')
            ).toBe(
                diff.post
                    .filter(part => !part.changed)
                    .map(part => part.text)
                    .join('')
            )
        }
    })

    test('keeps a long shared prefix and suffix outside the changed words', () => {
        const shared = 'Same words. '.repeat(10_000)
        const diff = diffWords(`${shared}before ${shared}`, `${shared}after ${shared}`)
        expect(changed(diff.current)).toEqual(['before'])
        expect(changed(diff.post)).toEqual(['after'])
    })
})
