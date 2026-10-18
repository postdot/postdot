import { getTargetEditorFields } from './target-editor'

export function getComposerTextFields(profile: unknown, target?: unknown) {
    const capabilities =
        isRecord(profile) && isRecord(profile.capabilities) ? profile.capabilities : null
    const textFields = Array.isArray(capabilities?.textFields) ? capabilities.textFields : []
    const fields = getTargetEditorFields(profile, undefined, target)
    const read = (semantic: 'headline' | 'primary_text') => {
        const field = fields.find(item => item.semantic === semantic && item.kind === 'text')
        if (field === undefined) return null
        const capability = textFields.find(
            item => isRecord(item) && item.bindingId === field.bindingId
        )
        return {
            field,
            maxGraphemes:
                isRecord(capability) &&
                typeof capability.maxGraphemes === 'number' &&
                Number.isSafeInteger(capability.maxGraphemes) &&
                capability.maxGraphemes >= 0
                    ? capability.maxGraphemes
                    : null,
        }
    }
    return { headline: read('headline'), body: read('primary_text') }
}

export function countComposerText(
    text: string,
    constraint: NonNullable<ReturnType<typeof getComposerTextFields>['body']>
) {
    const characters =
        constraint.field.textLengthUnit === 'utf16' ? text.length : Array.from(text).length
    const graphemes =
        constraint.maxGraphemes === null
            ? null
            : Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
                  .length
    return {
        characters,
        graphemes,
        invalid:
            text.length > 0 &&
            ((constraint.field.maxLength !== null && characters > constraint.field.maxLength) ||
                (constraint.field.minLength !== null && characters < constraint.field.minLength) ||
                (constraint.maxGraphemes !== null &&
                    graphemes !== null &&
                    graphemes > constraint.maxGraphemes)),
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
