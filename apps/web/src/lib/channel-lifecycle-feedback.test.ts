import { expect, test } from 'bun:test'

import * as m from '@/paraglide/messages.js'

import { formatChannelLifecycleConflict } from './channel-lifecycle-feedback'

test('explains why linked publications block permanent deletion', () => {
    expect(formatChannelLifecycleConflict(['publications'])).toBe(m.channel_blocked_publications())
    expect(formatChannelLifecycleConflict(['publications'])).not.toContain('Request failed')
})
test('keeps all actionable blockers without repeating a reason', () => {
    expect(
        formatChannelLifecycleConflict(['publisher', 'pending_authorization', 'publisher'])
    ).toBe(`${m.channel_blocked_publisher()} ${m.channel_blocked_authorization()}`)
})
test('uses a readable recovery message for absent or unknown blocker codes', () => {
    expect(formatChannelLifecycleConflict([])).toBe(m.channel_blocked_generic())
    expect(formatChannelLifecycleConflict(['internal-new-code'])).toBe(m.channel_blocked_generic())
})
