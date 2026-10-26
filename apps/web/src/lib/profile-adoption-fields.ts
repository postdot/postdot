import { readTargetField, type TargetEditorField } from './target-editor'

/** Binding identity and semantic role are evidence; labels and nearby paths are not. */
export function compareAdoptionFields(
    previous: Record<string, unknown>,
    oldFields: readonly TargetEditorField[],
    fields: readonly TargetEditorField[]
) {
    return oldFields.flatMap(old => {
        if (readTargetField(previous, old.path) === undefined) return []
        const next = fields.find(
            field => field.bindingId === old.bindingId && field.semantic === old.semantic
        )
        const status =
            next === undefined
                ? 'removed'
                : old.schemaType !== next.schemaType || old.kind !== next.kind
                  ? 'changed'
                  : 'matching'
        const reusable =
            status === 'matching' &&
            next !== undefined &&
            next.schemaType !== null &&
            next.kind !== 'unsupported' &&
            next.kind !== 'readonly'
        return [{ previous: old, next, status, reusable }]
    })
}
