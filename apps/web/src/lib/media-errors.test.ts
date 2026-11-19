import { describe, expect, test } from 'bun:test'

import {
    MediaVerificationError,
    mediaFailureReason,
    mediaVerificationDiagnostic,
} from './media-errors'

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

describe('media failure reasons', () => {
    test('maps known failure codes to plain-language reason categories', () => {
        const cases = [
            ['unsupported_format', 'unsupported_format'],
            ['invalid_content_type', 'unsupported_format'],
            ['write_limit_exceeded', 'file_too_large'],
            ['read_limit_exceeded', 'file_too_large'],
            ['upload_expired', 'upload_expired'],
            ['size_mismatch', 'upload_incomplete'],
            ['invalid_source', 'upload_incomplete'],
            ['storage_missing', 'file_missing'],
            ['storage_failure', 'file_missing'],
        ] as const

        for (const [failureCode, expected] of cases) {
            expect(
                mediaFailureReason({
                    asset: { failureCode, failureMessage: 'raw technical trace' },
                    representations: [],
                })
            ).toBe(expected)
        }
    })

    test('reads a representation failureCode when the asset code is missing', () => {
        expect(
            mediaFailureReason({
                asset: { failureCode: null, failureMessage: null },
                representations: [{ failureCode: 'upload_expired', failureMessage: null }],
            })
        ).toBe('upload_expired')
    })

    test('falls back to generic for unknown or absent codes without using failureMessage', () => {
        expect(
            mediaFailureReason({
                asset: {
                    failureCode: 'unexpected_internal_code',
                    failureMessage: 'SQLITE_BUSY: database is locked',
                },
                representations: [],
            })
        ).toBe('generic')
        expect(
            mediaFailureReason({
                asset: { failureCode: null, failureMessage: 'raw technical error' },
                representations: [],
            })
        ).toBe('generic')
    })
})
