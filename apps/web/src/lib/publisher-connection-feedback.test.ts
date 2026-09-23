import { describe, expect, it } from 'bun:test'

import {
    isPublisherCallbackResult,
    parsePublisherCallbackResult,
    publisherCallbackResults,
} from './publisher-connection-feedback'

describe('publisher callback feedback', () => {
    it('accepts every callback result that the API can return', () => {
        for (const result of publisherCallbackResults) {
            expect(parsePublisherCallbackResult(result)).toBe(result)
            expect(isPublisherCallbackResult(result)).toBe(true)
        }
    })

    it('ignores unknown or malformed query values', () => {
        expect(parsePublisherCallbackResult('unexpected')).toBeUndefined()
        expect(parsePublisherCallbackResult(undefined)).toBeUndefined()
        expect(parsePublisherCallbackResult(42)).toBeUndefined()
    })
})
