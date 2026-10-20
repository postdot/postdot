import { describe, expect, it } from 'bun:test'

import {
    alphabeticVariant,
    channelNameExists,
    channelVariant,
    suggestChannelName,
} from './channel-identity'

describe('project channel identity', () => {
    it('keeps one platform unmarked and orders repeated platforms by creation rather than name', () => {
        const first = { id: 'old', name: 'Renamed account', profileId: 'x', createdAt: 10 }
        const second = { id: 'new', name: 'X.com', profileId: 'x', createdAt: 20 }
        const other = { id: 'other', name: 'Community', profileId: 'bluesky', createdAt: 5 }
        expect(channelVariant(first.id, [first, other])).toBeUndefined()
        expect(channelVariant(first.id, [second, other, first])).toBe('A')
        expect(channelVariant(second.id, [second, other, first])).toBe('B')
        expect(channelVariant(other.id, [second, other, first])).toBeUndefined()
        expect(channelVariant('unknown', [first])).toBeUndefined()
    })
    it('marks repeated native Instagram destinations by creation order', () => {
        const first = { id: 'one', name: 'Instagram', profileId: 'instagram', createdAt: 10 }
        const second = { id: 'two', name: 'Instagram', profileId: 'instagram', createdAt: 20 }
        expect(channelVariant(first.id, [first, second])).toBe('A')
        expect(channelVariant(second.id, [first, second])).toBe('B')
        expect(channelVariant(first.id, [first])).toBeUndefined()
    })
    it('suggests an unused name while respecting edited labels and case-insensitive collisions', () => {
        expect(suggestChannelName('X.com', [])).toBe('X.com')
        expect(suggestChannelName('X.com', [' x.COM ', 'X.com B'])).toBe('X.com C')
        expect(channelNameExists('  Community ', ['community'])).toBe(true)
        expect(channelNameExists('News', ['Community'])).toBe(false)
        expect(suggestChannelName('X.com', ['Renamed', 'Another account'], 2)).toBe('X.com C')
        expect(alphabeticVariant(25)).toBe('Z')
        expect(alphabeticVariant(26)).toBe('AA')
    })
})
