import { describe, expect, it } from 'bun:test'

import { isXPostTextValid, parseXPostText } from './text'

describe('X weighted post-text validation', () => {
    it('counts plain ASCII text by code points', () => {
        expect(parseXPostText('This is a test Tweet')).toEqual({
            weightedLength: 20,
            valid: true,
            hasInvalidCharacters: false,
        })
    })

    it('matches the twitter-text mixed-script reference example', () => {
        // 13 Latin + 3 CJK x2 + spaces + 1 emoji x2 + 1 URL x23 = 46.
        expect(parseXPostText('english text 日本語 😷 https://example.com')).toEqual({
            weightedLength: 46,
            valid: true,
            hasInvalidCharacters: false,
        })
    })

    it('counts every URL as 23 characters regardless of actual length', () => {
        expect(parseXPostText('https://example.com').weightedLength).toBe(23)
        expect(parseXPostText(`https://example.com/${'a'.repeat(200)}`).weightedLength).toBe(23)
        expect(parseXPostText('http://example.com').weightedLength).toBe(23)
        expect(parseXPostText('see https://example.com/a and http://x.test/bb')).toEqual(
            expect.objectContaining({ weightedLength: 4 + 23 + 5 + 23 })
        )
    })

    it('excludes trailing punctuation from URLs', () => {
        expect(parseXPostText('(https://example.com).').weightedLength).toBe(1 + 23 + 2)
        expect(parseXPostText('Read https://example.com!').weightedLength).toBe(5 + 23 + 1)
    })

    it('counts one emoji as 2 characters', () => {
        expect(parseXPostText('😷').weightedLength).toBe(2)
        expect(parseXPostText('a😷b').weightedLength).toBe(4)
    })

    it('counts emoji clusters with modifiers as a single emoji', () => {
        expect(parseXPostText('👍🏽').weightedLength).toBe(2)
        expect(parseXPostText('👨‍👩‍👧‍👦').weightedLength).toBe(2)
        expect(parseXPostText('🇫🇷').weightedLength).toBe(2)
        expect(parseXPostText('1️⃣').weightedLength).toBe(2)
    })

    it('counts CJK characters as 2 characters each', () => {
        expect(parseXPostText('日本語').weightedLength).toBe(6)
        expect(parseXPostText('한글').weightedLength).toBe(4)
    })

    it('normalizes to NFC before counting', () => {
        expect(parseXPostText('é').weightedLength).toBe(1)
        expect(parseXPostText('é').weightedLength).toBe(1)
        expect(parseXPostText('é').weightedLength).toBe(parseXPostText('é').weightedLength)
    })

    it('accepts exactly 280 weighted characters and rejects 281', () => {
        expect(isXPostTextValid('a'.repeat(280))).toBe(true)
        expect(isXPostTextValid('a'.repeat(281))).toBe(false)
        expect(isXPostTextValid('日'.repeat(140))).toBe(true)
        expect(isXPostTextValid('日'.repeat(141))).toBe(false)
    })

    it('applies the URL weight at the validity boundary', () => {
        expect(isXPostTextValid(`${'a'.repeat(256)} https://example.com`)).toBe(true)
        expect(isXPostTextValid(`${'a'.repeat(257)} https://example.com`)).toBe(false)
    })

    it('rejects invalid characters', () => {
        const rejected = parseXPostText('hello￾world')
        expect(rejected.hasInvalidCharacters).toBe(true)
        expect(rejected.valid).toBe(false)
        expect(isXPostTextValid('tab\there and\nnew lines are fine')).toBe(true)
    })

    it('rejects empty text', () => {
        expect(parseXPostText('   ').valid).toBe(false)
    })
})
