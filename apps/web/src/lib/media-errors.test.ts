import { describe, expect, test } from 'bun:test'

import { MediaVerificationError, mediaVerificationDiagnostic } from './media-errors'

describe('media verification diagnostics', () => {
    test('preserves a safe server failure code and detail', () => {
        const media = {
            asset: {
                failureCode: 'storage_missing',
                failureMessage: 'The stored media object is no longer available',
            },
            representations: [],
        }

        expect(mediaVerificationDiagnostic(media)).toEqual({
            code: 'storage_missing',
            detail: 'The stored media object is no longer available',
        })
        expect(new MediaVerificationError(media)).toMatchObject({
            code: 'storage_missing',
            detail: 'The stored media object is no longer available',
        })
    })

    test('normalizes unexpected diagnostic control characters and length', () => {
        const media = {
            asset: {
                failureCode: 'storage failure',
                failureMessage: 'A diagnostic\nwith control text',
            },
            representations: [],
        }

        expect(mediaVerificationDiagnostic(media)).toEqual({
            code: 'storage_failure',
            detail: 'A diagnostic with control text',
        })
    })
})
