import { expect, test } from 'bun:test'

import { ChannelProfileValidationError } from '@postbot/core'

import { profileValidationFeedback } from './profile-validation-feedback'

test('profile feedback retains only bounded known codes and pointers, never diagnostic text', () => {
    const error = new ChannelProfileValidationError([
        {
            code: 'binding.path_missing',
            path: '/fieldBindings/0/path',
            message: 'FAKE_SENTINEL',
            severity: 'error',
            source: 'field_binding',
        },
        {
            code: 'profile.schema_compile_failed',
            path: '/contentSchema',
            message: 'FAKE_SENTINEL',
            severity: 'error',
            source: 'schema_policy',
        },
        {
            code: 'binding.path_missing',
            path: '/FAKE_SENTINEL',
            message: 'FAKE_SENTINEL',
            severity: 'error',
            source: 'module',
        },
        {
            code: 'profile.string_required',
            path: '/bad~escape',
            message: 'FAKE_SENTINEL',
            severity: 'error',
            source: 'domain',
        },
        ...Array.from({ length: 25 }, () => ({
            code: 'profile.object_required',
            path: '/capabilities',
            message: 'FAKE_SENTINEL',
            severity: 'error' as const,
            source: 'domain' as const,
        })),
    ])
    const feedback = profileValidationFeedback(error)
    expect(feedback.error.issueCount).toBe(29)
    expect(feedback.error.issues).toHaveLength(20)
    expect(feedback.error.issues[0]).toEqual({
        code: 'binding.path_missing',
        path: '/fieldBindings/0/path',
    })
    expect(feedback.error.issues[1]).toEqual({ code: 'profile.definition_invalid', path: '' })
    expect(feedback.error.issues[2]).toEqual({ code: 'profile.definition_invalid', path: '' })
    expect(feedback.error.issues[3]?.path).toBe('')
    expect(JSON.stringify(feedback)).not.toContain('FAKE_SENTINEL')
})
