import { describe, expect, it } from 'bun:test'

import { channelHasBrandIcon } from './identity-visuals'

describe('channel identity visuals', () => {
    it('uses a local brand icon for every built-in provider', () => {
        expect(channelHasBrandIcon('bluesky')).toBe(true)
        expect(channelHasBrandIcon('devto')).toBe(true)
        expect(channelHasBrandIcon('discord')).toBe(true)
        expect(channelHasBrandIcon('linkedin')).toBe(true)
        expect(channelHasBrandIcon('mastodon')).toBe(true)
        expect(channelHasBrandIcon('x')).toBe(true)
    })

    it('keeps custom profiles on the generated identity path', () => {
        expect(channelHasBrandIcon('custom-profile')).toBe(false)
    })
})
