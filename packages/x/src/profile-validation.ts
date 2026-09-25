import type {
    ChannelProfileDefinition,
    ChannelProfileValidationAdapter,
    JsonSchema,
    ValidationIssue,
} from '@herald/core'

import {
    X_MAX_RAW_POST_TEXT_LENGTH,
    X_MAX_WEIGHTED_POST_LENGTH,
    X_TEXT_COUNTING_ALGORITHM,
    parseXPostText,
} from './text'

const X_TEXT_PATH = '/text'

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validationIssue(code: string, message: string): ValidationIssue {
    return {
        path: X_TEXT_PATH,
        code,
        message,
        severity: 'error',
        source: 'capability',
    }
}

function prepareXProfile(profile: ChannelProfileDefinition): ChannelProfileDefinition {
    const schema = profile.contentSchema
    if (!isRecord(schema) || !isRecord(schema.properties)) return profile
    const textSchema = schema.properties.text
    if (!isRecord(textSchema) || textSchema.type !== 'string') return profile

    const textBindingIds = new Set(
        profile.fieldBindings
            .filter(binding => binding.semantic === 'primary_text' && binding.path === X_TEXT_PATH)
            .map(binding => binding.id)
    )
    const textFields = profile.capabilities.textFields.map(capability => {
        if (!textBindingIds.has(capability.bindingId)) return capability

        return {
            ...capability,
            maxLength: X_MAX_RAW_POST_TEXT_LENGTH,
            maxGraphemes: X_MAX_RAW_POST_TEXT_LENGTH,
            maxWeightedLength: X_MAX_WEIGHTED_POST_LENGTH,
            weightedLengthAlgorithm: X_TEXT_COUNTING_ALGORITHM,
        }
    })

    return {
        ...profile,
        contentSchema: {
            ...(schema as JsonSchema),
            properties: {
                ...schema.properties,
                text: {
                    ...textSchema,
                    maxLength: X_MAX_RAW_POST_TEXT_LENGTH,
                },
            },
        },
        capabilities: {
            ...profile.capabilities,
            textFields,
        },
    }
}

function validateXContent(content: Readonly<Record<string, unknown>>): readonly ValidationIssue[] {
    const text = content.text
    if (typeof text !== 'string') return []

    const parsed = parseXPostText(text)
    if (text.trim().length === 0) {
        return [validationIssue('content.text_blank', 'X post text must not be blank')]
    }
    if (parsed.hasInvalidCharacters) {
        return [
            validationIssue(
                'content.invalid_characters',
                'X post text contains characters that the provider does not allow'
            ),
        ]
    }
    if (parsed.weightedLength !== null && parsed.weightedLength > X_MAX_WEIGHTED_POST_LENGTH) {
        return [
            validationIssue(
                'content.weighted_length',
                `X post text has weighted length ${parsed.weightedLength}; the maximum is ${X_MAX_WEIGHTED_POST_LENGTH}`
            ),
        ]
    }

    return parsed.valid
        ? []
        : [validationIssue('content.invalid_text', 'X post text is not valid for publication')]
}

/** Runtime-only X rules used by the shared channel-profile compiler. */
export const xChannelProfileValidationAdapter: ChannelProfileValidationAdapter = {
    contractId: 'x',
    prepareProfile: prepareXProfile,
    validate: (_profile, content) => validateXContent(content),
}
