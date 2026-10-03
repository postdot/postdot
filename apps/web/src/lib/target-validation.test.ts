import { expect, test } from 'bun:test'

import { getTargetEditorFields } from './target-editor'
import { validationField } from './target-validation'

const fields = getTargetEditorFields(
    {
        contentSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                media: { type: 'array', items: { type: 'string' } },
            },
        },
        fieldBindings: [],
    },
    'en'
)

test('associates exact and nested issue paths without confusing neighboring fields', () => {
    expect(validationField(fields, { path: '/title' })?.path).toBe('/title')
    expect(validationField(fields, { path: '/media/0' })?.path).toBe('/media')
    expect(validationField(fields, { path: '/titleExtra' })).toBeUndefined()
    expect(validationField(fields, { path: '' })).toBeUndefined()
    expect(validationField(fields, { path: 2 })).toBeUndefined()
})
