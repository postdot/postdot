import { describe, expect, it } from 'bun:test'

import { X_MAX_WEIGHTED_POST_LENGTH, isXPostTextValid, parseXPostText } from './text'

describe('X post-text validation through twitter-text', () => {
    it('uses the upstream weighted count for ordinary and mixed-script text', () => {
        expect(parseXPostText('This is a test Tweet')).toEqual({
            weightedLength: 20,
            valid: true,
            hasInvalidCharacters: false,
        })
        expect(parseXPostText('english text 日本語 😷 https://example.com')).toEqual({
            weightedLength: 46,
            valid: true,
            hasInvalidCharacters: false,
        })
    })

    it('counts long URLs as 23 weighted characters', () => {
        const longUrl = `https://example.com/${'a'.repeat(300)}`

        expect(longUrl.length).toBeGreaterThan(X_MAX_WEIGHTED_POST_LENGTH)
        expect(parseXPostText(longUrl)).toEqual({
            weightedLength: 23,
            valid: true,
            hasInvalidCharacters: false,
        })
        expect(isXPostTextValid(`${'a'.repeat(256)} ${longUrl}`)).toBe(true)
        expect(isXPostTextValid(`${'a'.repeat(257)} ${longUrl}`)).toBe(false)
    })

    it('counts the upstream URL extraction and trailing punctuation behavior', () => {
        expect(parseXPostText('(https://example.com).').weightedLength).toBe(26)
        expect(parseXPostText('Read https://example.com!').weightedLength).toBe(29)
        expect(parseXPostText('see https://example.com/a and http://x.com/bb').weightedLength).toBe(
            55
        )
    })

    it('counts emoji sequences as the upstream parser does', () => {
        expect(parseXPostText('😷').weightedLength).toBe(2)
        expect(parseXPostText('a😷b').weightedLength).toBe(4)
        expect(parseXPostText('👍🏽').weightedLength).toBe(2)
        expect(parseXPostText('👨‍👩‍👧‍👦').weightedLength).toBe(2)
        expect(parseXPostText('🇫🇷').weightedLength).toBe(2)
        expect(parseXPostText('1️⃣').weightedLength).toBe(2)
    })

    it('counts CJK as two and normalizes text to NFC', () => {
        expect(parseXPostText('日本語').weightedLength).toBe(6)
        expect(parseXPostText('한글').weightedLength).toBe(4)
        expect(parseXPostText('é').weightedLength).toBe(1)
        expect(parseXPostText('é').weightedLength).toBe(1)
        expect(parseXPostText('é').weightedLength).toBe(parseXPostText('é').weightedLength)
    })

    it('enforces 280 weighted characters rather than 280 raw characters', () => {
        expect(isXPostTextValid('a'.repeat(280))).toBe(true)
        expect(isXPostTextValid('a'.repeat(281))).toBe(false)
        expect(isXPostTextValid('日'.repeat(140))).toBe(true)
        expect(isXPostTextValid('日'.repeat(141))).toBe(false)
        expect(isXPostTextValid('日'.repeat(200))).toBe(false)
    })

    it('uses upstream invalid-character detection and rejects blank text', () => {
        const rejected = parseXPostText('hello￾world')
        expect(rejected.hasInvalidCharacters).toBe(true)
        expect(rejected.valid).toBe(false)
        expect(isXPostTextValid('tab\there and\nnew lines are fine')).toBe(true)
        expect(isXPostTextValid('   ')).toBe(false)
    })
})
