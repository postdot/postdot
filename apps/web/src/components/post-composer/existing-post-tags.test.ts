import { expect, test } from 'bun:test'

import { changeSharedPublicationTags, sharedPublicationTags } from './composition-tags'

test('shared tags use the intersection across editable channels', () => {
    expect(
        sharedPublicationTags([
            ['common', 'own-one'],
            ['common', 'own-two'],
        ])
    ).toEqual(['common'])
    expect(sharedPublicationTags([])).toEqual([])
})

test('a shared assignment edit preserves each channel own tags', () => {
    expect(changeSharedPublicationTags(['common', 'own'], ['common'], ['new'])).toEqual([
        'own',
        'new',
    ])
    expect(changeSharedPublicationTags(['common'], ['common'], ['common', 'new'])).toEqual([
        'common',
        'new',
    ])
})
