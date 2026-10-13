import type { ChannelProfileDefinition } from '@postbot/core'

import { getTargetEditorFields } from './target-editor'

export function getComposerTextFields(profile: ChannelProfileDefinition) {
    const fields = getTargetEditorFields(profile)
    const read = (semantic: 'headline' | 'primary_text') => {
        const field = fields.find(item => item.semantic === semantic && item.kind === 'text')
        if (field === undefined) return null
        const capability = profile.capabilities.textFields.find(
            item => item.bindingId === field.bindingId
        )
        return {
            field,
            maxGraphemes: capability?.maxGraphemes ?? null,
        }
    }
    return { headline: read('headline'), body: read('primary_text') }
}

export function countComposerText(
    text: string,
    constraint: NonNullable<ReturnType<typeof getComposerTextFields>['body']>
) {
    const characters = Array.from(text).length
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
