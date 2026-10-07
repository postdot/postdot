import * as m from '@/paraglide/messages.js'

/** Never render API diagnostic messages or interpolate submitted values. */
export function profileIssueMessage(code: string): string {
    switch (code) {
        case 'profile.object_required':
            return m.profile_issue_object()
        case 'profile.array_required':
            return m.profile_issue_array()
        case 'profile.string_required':
            return m.profile_issue_string()
        case 'profile.number_required':
            return m.profile_issue_number()
        case 'profile.boolean_required':
            return m.profile_issue_boolean()
        case 'profile.root_object_required':
        case 'schema.root_object_required':
            return m.profile_issue_root_object()
        case 'profile.execution_identity_required':
            return m.profile_issue_execution_identity()
        case 'binding.id_blank':
        case 'capability.revision_blank':
            return m.profile_issue_nonblank()
        case 'binding.id_duplicate':
        case 'binding.path_duplicate':
        case 'capability.binding_duplicate':
            return m.profile_issue_duplicate()
        case 'binding.path_invalid':
            return m.profile_issue_pointer()
        case 'binding.path_missing':
            return m.profile_issue_schema_field()
        case 'capability.binding_missing':
            return m.profile_issue_binding()
        case 'binding.media_array_required':
            return m.profile_issue_media_array()
        case 'capability.limit_invalid':
            return m.profile_issue_limit()
        case 'capability.range_invalid':
            return m.profile_issue_range()
        case 'capability.formats_invalid':
            return m.profile_issue_formats()
        case 'capability.media_types_required':
        case 'capability.media_types_duplicate':
            return m.profile_issue_media_types()
        case 'capability.weighted_algorithm_required':
        case 'capability.weighted_algorithm_invalid':
            return m.profile_issue_weighted_algorithm()
        case 'capability.self_relation':
            return m.profile_issue_self_relation()
        case 'schema.keyword_forbidden':
            return m.profile_issue_schema_keyword()
        case 'schema.dialect_required':
            return m.profile_issue_schema_dialect()
        default:
            return m.profile_issue_general()
    }
}
