import { describe, expect, test } from 'bun:test'

import * as m from '@/paraglide/messages.js'

import { notificationContent } from './notification-content'

describe('notification content', () => {
    test('localizes owned delivery copy without repeating the confirmation', () => {
        const notification = {
            kind: 'publication_published' as const,
            title: 'Publication delivered',
            body: 'Postbot confirmed that the publication was delivered.',
        }
        expect(notificationContent(notification, 'fr')).toEqual({
            title: m.notification_delivered_title({}, { locale: 'fr' }),
            body: null,
        })
        expect(notificationContent(notification, 'en')).toEqual({
            title: 'Publication delivered',
            body: null,
        })
        expect(notification.title).toBe('Publication delivered')
    })

    test('retains the uncertainty and reconciliation distinctions', () => {
        expect(
            notificationContent(
                {
                    kind: 'publication_ambiguous',
                    title: 'Publication outcome unknown',
                    body: 'Postbot could not confirm whether the publication was delivered.',
                },
                'fr'
            )
        ).toEqual({
            title: m.notification_uncertain_title({}, { locale: 'fr' }),
            body: m.notification_uncertain_body({}, { locale: 'fr' }),
        })
        expect(
            notificationContent(
                {
                    kind: 'publication_failed',
                    title: 'Publication reconciled as failed',
                    body: 'A previously uncertain publication was confirmed as failed.',
                },
                'en'
            )
        ).toEqual({
            title: 'Failure confirmed',
            body: 'The previously uncertain outcome has been verified.',
        })
        expect(
            notificationContent(
                {
                    kind: 'publication_published',
                    title: 'Publication reconciled as delivered',
                    body: 'A previously uncertain publication was confirmed as delivered.',
                },
                'fr'
            ).title
        ).toBe(m.notification_reconciled_delivered_title({}, { locale: 'fr' }))
        expect(
            notificationContent(
                {
                    kind: 'publication_failed',
                    title: 'Publication failed',
                    body: 'The publication could not be delivered and needs attention.',
                },
                'fr'
            ).title
        ).toBe(m.notification_failed_title({}, { locale: 'fr' }))
    })

    test('preserves unfamiliar copy even when its kind or title matches', () => {
        const custom = {
            kind: 'publication_failed' as const,
            title: 'Publication failed',
            body: 'A custom diagnostic supplied by an integration.',
        }
        expect(notificationContent(custom, 'fr')).toEqual({
            title: custom.title,
            body: custom.body,
        })
        const mismatched = {
            kind: 'publication_failed' as const,
            title: 'Publication delivered',
            body: 'Postbot confirmed that the publication was delivered.',
        }
        expect(notificationContent(mismatched, 'fr')).toEqual({
            title: mismatched.title,
            body: mismatched.body,
        })
    })
})
