import { expect, test } from 'bun:test'

import { shortExcerpt } from './publication-identity'

test('keeps short text whole', () => {
    expect(shortExcerpt('Winter release is live')).toBe('Winter release is live')
})

test('drops links and cuts long text on a word boundary', () => {
    const excerpt = shortExcerpt(
        'Winter release is live with a calmer calendar and better previews. Full notes: https://postdot.example/notes'
    )
    expect(excerpt).not.toContain('https')
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(61)
    expect(excerpt).toBe('Winter release is live with a calmer calendar and better…')
})
