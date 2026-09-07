import type { MediaReference } from './api'

export interface MediaVerificationDiagnostic {
    readonly code: string
    readonly detail: string | null
}

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
