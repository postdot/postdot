import type { TargetEditorField } from './target-editor'

// Match pointer boundaries so /media/0 belongs to /media, but /titleExtra does not.
export function validationField(
    fields: readonly TargetEditorField[],
    issue: Readonly<Record<string, unknown>>
): TargetEditorField | undefined {
    if (typeof issue.path !== 'string' || issue.path === '') return undefined
    const path = issue.path
    return fields
        .filter(field => path === field.path || path.startsWith(`${field.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]
}
