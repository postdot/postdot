import { describe, expect, test } from 'bun:test'

import { notificationContent } from './notification-content'

describe('notification content', () => {
    test('preserves the server-provided title and body', () => {
        const content = notificationContent({
            title: 'Publication reconciled as failed',
            body: 'A previously uncertain publication was confirmed as failed.',
        })

        expect(content).toEqual({
            title: 'Publication reconciled as failed',
            body: 'A previously uncertain publication was confirmed as failed.',
        })
    })
})
