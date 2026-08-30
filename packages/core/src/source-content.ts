import { Type, type Static } from 'typebox'
import Schema from 'typebox/schema'

import {
    hasValidationErrors,
    type ValidationIssue,
    type ValidationResult,
    validationFailure,
    validationSuccess,
} from './validation'

export const sourceTextFormats = ['plain_text', 'markdown'] as const

export type SourceTextFormat = (typeof sourceTextFormats)[number]

export const sourceContentSchema = Type.Object(
    {
        body: Type.Optional(
            Type.Object(
                {
                    text: Type.String({ minLength: 1, maxLength: 1_000_000 }),
                    format: Type.Union([Type.Literal('plain_text'), Type.Literal('markdown')]),
                },
                { additionalProperties: false }
            )
        ),
        headline: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })),
        language: Type.Optional(Type.String({ minLength: 2, maxLength: 35 })),
        media: Type.Array(
            Type.Object(
                {
                    assetId: Type.String({ minLength: 1, maxLength: 255 }),
                    accessibilityText: Type.Optional(
                        Type.String({ minLength: 1, maxLength: 10_000 })
                    ),
                },
                { additionalProperties: false }
            ),
            { maxItems: 256 }
        ),
    },
    { additionalProperties: false }
)

export type SourceContent = Static<typeof sourceContentSchema>

const sourceContentValidator = Schema.Compile(sourceContentSchema)

function schemaIssues(value: unknown): ValidationIssue[] {
    const [, errors] = sourceContentValidator.Errors(value)

    return errors.map(error => ({
        path: error.instancePath,
        code: `schema.${error.keyword}`,
        message: error.message,
        severity: 'error',
        source: 'schema',
    }))
}

function isBcp47LanguageTag(value: string): boolean {
    try {
        return Intl.getCanonicalLocales(value).length === 1
    } catch {
        return false
    }
}

export function validateSourceContent(value: unknown): ValidationResult<SourceContent> {
    if (!sourceContentValidator.Check(value)) {
        return validationFailure(schemaIssues(value))
    }

    const issues: ValidationIssue[] = []

    if (value.body === undefined && value.media.length === 0) {
        issues.push({
            path: '',
            code: 'source.content_required',
            message: 'Source content must contain a body or at least one media reference',
            severity: 'error',
            source: 'domain',
        })
    }

    if (value.body !== undefined && value.body.text.trim().length === 0) {
        issues.push({
            path: '/body/text',
            code: 'source.body_blank',
            message: 'Source body text must not be blank',
            severity: 'error',
            source: 'domain',
        })
    }

    if (value.headline !== undefined && value.headline.trim().length === 0) {
        issues.push({
            path: '/headline',
            code: 'source.headline_blank',
            message: 'Source headline must not be blank',
            severity: 'error',
            source: 'domain',
        })
    }

    if (value.language !== undefined && !isBcp47LanguageTag(value.language)) {
        issues.push({
            path: '/language',
            code: 'source.language_invalid',
            message: 'Source language must be a valid BCP 47 language tag',
            severity: 'error',
            source: 'domain',
        })
    }

    for (const [index, media] of value.media.entries()) {
        if (media.assetId.trim().length === 0) {
            issues.push({
                path: `/media/${index}/assetId`,
                code: 'source.media_asset_id_blank',
                message: 'Media asset ID must not be blank',
                severity: 'error',
                source: 'domain',
            })
        }

        if (media.accessibilityText !== undefined && media.accessibilityText.trim().length === 0) {
            issues.push({
                path: `/media/${index}/accessibilityText`,
                code: 'source.accessibility_text_blank',
                message: 'Media accessibility text must not be blank when provided',
                severity: 'error',
                source: 'domain',
            })
        }
    }

    return hasValidationErrors(issues)
        ? validationFailure(issues)
        : validationSuccess(value, issues)
}
