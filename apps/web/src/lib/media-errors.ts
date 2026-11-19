import type { MediaReference } from './api'

export interface MediaVerificationDiagnostic {
    readonly code: string
    readonly detail: string | null
}

export type MediaFailureReason =
    | 'unsupported_format'
    | 'file_too_large'
    | 'upload_expired'
    | 'upload_incomplete'
    | 'file_missing'
    | 'generic'

type MediaFailureFields = Pick<MediaReference['asset'], 'failureCode' | 'failureMessage'>
type MediaWithFailureFields = {
    readonly asset: MediaFailureFields
    readonly representations: readonly MediaFailureFields[]
}

export class MediaVerificationError extends Error {
    readonly code: string
    readonly detail: string | null

    constructor(media: MediaWithFailureFields) {
        const diagnostic = mediaVerificationDiagnostic(media)
        super(diagnostic.detail ?? diagnostic.code)
        this.name = 'MediaVerificationError'
        this.code = diagnostic.code
        this.detail = diagnostic.detail
    }
}

export function mediaFailureReason(media: MediaWithFailureFields): MediaFailureReason {
    const rawCode = [media.asset, ...media.representations]
        .map(candidate => candidate.failureCode?.trim().toLowerCase())
        .find(candidate => candidate !== undefined && candidate !== '')

    switch (rawCode) {
        case 'unsupported_format':
        case 'invalid_content_type':
            return 'unsupported_format'
        case 'write_limit_exceeded':
        case 'read_limit_exceeded':
        case 'invalid_byte_limit':
            return 'file_too_large'
        case 'upload_expired':
            return 'upload_expired'
        case 'size_mismatch':
        case 'invalid_source':
            return 'upload_incomplete'
        case 'storage_missing':
        case 'storage_failure':
            return 'file_missing'
        default:
            return 'generic'
    }
}

export function mediaVerificationDiagnostic(
    media: MediaWithFailureFields
): MediaVerificationDiagnostic {
    const failure = [media.asset, ...media.representations].find(
        candidate => candidate.failureCode !== null || candidate.failureMessage !== null
    )

    return {
        code: normalizeFailureCode(failure?.failureCode),
        detail: normalizeFailureDetail(failure?.failureMessage),
    }
}

function normalizeFailureCode(code: string | null | undefined) {
    const normalized = code
        ?.trim()
        .replaceAll(/[^A-Za-z0-9_.-]/g, '_')
        .slice(0, 120)
    return normalized === undefined || normalized === '' ? 'media_verification_failed' : normalized
}

function normalizeFailureDetail(detail: string | null | undefined) {
    const normalized = detail
        ? Array.from(detail, character => {
              const codePoint = character.codePointAt(0) ?? 0
              return codePoint >= 32 && codePoint !== 127 ? character : ' '
          })
              .join('')
              .trim()
              .slice(0, 500)
        : undefined
    return normalized === undefined || normalized === '' ? null : normalized
}
