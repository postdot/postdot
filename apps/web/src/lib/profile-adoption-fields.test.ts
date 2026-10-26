import { describe, expect, it } from 'bun:test'

import { compareAdoptionFields } from './profile-adoption-fields'
import { getTargetEditorFields, updateTargetField } from './target-editor'

function profile(path = '/body', type = 'string', semantic = 'primary_text') {
    return {
        contentSchema: {
            type: 'object',
            properties: { [path.slice(1)]: { type, title: 'Identical label' } },
        },
        fieldBindings: [{ id: 'copy', semantic, path }],
    }
}

describe('explicit adoption reuse', () => {
    it('offers exact reuse across a path change without changing either saved value', () => {
        const previous = { body: 'Keep my copy', extra: { audit: 'Unrepresented data' } }
        const before = structuredClone(previous)
        const [change] = compareAdoptionFields(
            previous,
            getTargetEditorFields(profile()),
            getTargetEditorFields(profile('/article'))
        )
        expect(change?.reusable).toBe(true)
        expect(change?.next?.path).toBe('/article')
        expect(updateTargetField({}, change!.next!.path, previous.body)).toEqual({
            article: 'Keep my copy',
        })
        expect(previous).toEqual(before)
    })

    it('surfaces a changed type without coercing or suggesting its old value', () => {
        const [change] = compareAdoptionFields(
            { body: '123' },
            getTargetEditorFields(profile()),
            getTargetEditorFields(profile('/body', 'number'))
        )
        expect(change?.status).toBe('changed')
        expect(change?.reusable).toBe(false)
    })

    it('does not infer identity from matching labels or paths', () => {
        const [change] = compareAdoptionFields(
            { body: 'Original' },
            getTargetEditorFields(profile()),
            getTargetEditorFields(profile('/body', 'string', 'headline'))
        )
        expect(change?.status).toBe('removed')
        expect(change?.reusable).toBe(false)
    })

    it('keeps false, zero, empty strings and null visible while omitting absent fields', () => {
        for (const value of [false, 0, '', null]) {
            expect(
                compareAdoptionFields({ body: value }, getTargetEditorFields(profile()), [])
            ).toHaveLength(1)
        }
        expect(compareAdoptionFields({}, getTargetEditorFields(profile()), [])).toEqual([])
    })

    it('does not offer unsupported or read-only fields as form conversions', () => {
        for (const type of ['object', 'array']) {
            const fields = getTargetEditorFields(profile('/body', type))
            expect(compareAdoptionFields({ body: {} }, fields, fields)[0]?.reusable).toBe(false)
        }
        const original = profile()
        const readonly = {
            ...original,
            contentSchema: {
                type: 'object',
                properties: { body: { type: 'string', readOnly: true } },
            },
        }
        const fields = getTargetEditorFields(readonly)
        expect(compareAdoptionFields({ body: 'Keep' }, fields, fields)[0]?.reusable).toBe(false)
    })
})
