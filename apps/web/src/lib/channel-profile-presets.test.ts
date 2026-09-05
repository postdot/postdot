import { describe, expect, test } from 'bun:test'

import { channelProfileTemplates } from '@/lib/channel-profile-presets'

describe('channel profile templates', () => {
    test('provide valid JSON-compatible starter profiles', () => {
        expect(channelProfileTemplates.map(template => template.id)).toEqual([
            'custom-manual',
            'custom-webhook',
        ])

        for (const template of channelProfileTemplates) {
            expect(() => JSON.stringify(template.profile)).not.toThrow()
            expect(template.profile.origin).toBe('custom')
            expect(template.profile.contentSchema).toMatchObject({ type: 'object' })
            expect(template.profile.fieldBindings).toEqual(expect.any(Array))
            const capabilities = template.profile.capabilities as {
                textFields?: unknown
                mediaFields?: unknown
            }
            expect(Array.isArray(capabilities.textFields)).toBe(true)
            expect(Array.isArray(capabilities.mediaFields)).toBe(true)
        }
    })

    test('distinguishes manual and declarative HTTP execution', () => {
        expect(channelProfileTemplates[0]?.profile.execution).toEqual({ kind: 'manual' })
        expect(channelProfileTemplates[1]?.profile.execution).toMatchObject({
            kind: 'declarative_http',
            mode: 'herald_webhook',
        })
    })
})
