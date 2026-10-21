import type { ChannelProfileValidationError } from '@postdot/core'
import { Type } from 'typebox'

const publicCodes = new Set([
    'profile.object_required',
    'profile.array_required',
    'profile.string_required',
    'profile.number_required',
    'profile.boolean_required',
    'profile.root_object_required',
    'profile.execution_identity_required',
    'binding.id_blank',
    'binding.id_duplicate',
    'binding.path_invalid',
    'binding.path_duplicate',
    'binding.path_missing',
    'binding.media_array_required',
    'capability.revision_blank',
    'capability.binding_missing',
    'capability.limit_invalid',
    'capability.range_invalid',
    'capability.formats_invalid',
    'capability.binding_duplicate',
    'capability.media_types_required',
    'capability.media_types_duplicate',
    'capability.weighted_algorithm_required',
    'capability.weighted_algorithm_invalid',
    'capability.self_relation',
    'schema.keyword_forbidden',
    'schema.root_object_required',
    'schema.dialect_required',
])

export const profileDraftErrorResponse = Type.Object({
    error: Type.Object({
        code: Type.String(),
        message: Type.String(),
        issues: Type.Optional(
            Type.Array(
                Type.Object({
                    path: Type.String({ maxLength: 512 }),
                    code: Type.String(),
                }),
                { maxItems: 20 }
            )
        ),
        issueCount: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
})

/** Only fixed known codes and bounded field pointers cross the authoring boundary. */
export function profileValidationFeedback(error: ChannelProfileValidationError) {
    return {
        error: {
            code: error.code,
            message: 'Channel profile definition is invalid',
            issues: error.issues.slice(0, 20).map(issue => {
                const known = publicCodes.has(issue.code) && issue.source !== 'module'
                const pointer =
                    (issue.path === '' || issue.path.startsWith('/')) &&
                    !/~(?![01])/.test(issue.path) &&
                    !Array.from(issue.path).some(character => character.charCodeAt(0) < 32)
                return {
                    code: known ? issue.code : 'profile.definition_invalid',
                    path: known && pointer && issue.path.length <= 512 ? issue.path : '',
                }
            }),
            issueCount: Math.max(1, error.issues.length),
        },
    }
}
