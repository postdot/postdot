import { beforeAll, describe, expect, test } from 'bun:test'

import type { Notification } from './api'
import { loadLocale } from './i18n-store'
import { notificationChannelSummary, notificationOutcomeCopy } from './notification-content'
import {
    groupNotifications,
    notificationChannels,
    notificationSection,
    notificationTime,
} from './notification-groups'

beforeAll(async () => {
    await Promise.all(['fr', 'es', 'de'].map(loadLocale))
})

const now = Date.UTC(2026, 10, 16, 12)
function notification(id: string, offset = 0, overrides: Partial<Notification> = {}): Notification {
    return {
        id,
        projectId: 'project',
        sourceEventId: id,
        kind: 'publication_published',
        severity: 'success',
        subject: { type: 'publication', id },
        title: 'Publication delivered',
        body: 'Postdot confirmed that the publication was delivered.',
        createdAt: now - offset,
        readAt: null,
        archivedAt: null,
        context: {
            postId: 'post',
            postTitle: 'Release notes',
            sourceExcerpt: null,
            mediaCount: 0,
            canRetry: false,
            channel: { id, name: id, imageUrl: null },
            projectId: 'project',
            projectName: 'Studio',
            scheduledAt: null,
        },
        ...overrides,
    }
}

describe('notification groups', () => {
    test('groups the loaded post outcomes inside a bounded ten minute window', () => {
        const groups = groupNotifications([
            notification('old', 1_200_000),
            notification('middle', 600_000),
            notification('new'),
        ])
        expect(groups.map(group => group.members.map(item => item.id))).toEqual([
            ['new', 'middle'],
            ['old'],
        ])
        expect(groupNotifications([notification('a'), notification('b', 600_001)])).toHaveLength(2)
    })
    test('separates posts, projects, kinds, severity, missing context and reconciliation', () => {
        const base = notification('base')
        const contexts = [
            null,
            { ...base.context!, postId: 'other' },
            { ...base.context!, projectId: 'other' },
        ]
        for (const context of contexts)
            expect(groupNotifications([base, notification('other', 0, { context })])).toHaveLength(
                2
            )
        expect(
            groupNotifications([
                notification('a', 0, { context: null }),
                notification('b', 0, { context: null }),
            ])
        ).toHaveLength(2)
        for (const override of [
            { kind: 'publication_failed' as const },
            { severity: 'warning' as const },
            {
                title: 'Publication reconciled as delivered',
                body: 'A previously uncertain publication was confirmed as delivered.',
            },
        ])
            expect(groupNotifications([base, notification('other', 0, override)])).toHaveLength(2)
    })
    test('retains all members and deduplicates channels', () => {
        const first = notification('a', 0, { readAt: now })
        const groups = groupNotifications([
            first,
            notification('b', 1),
            notification('c', 2, { context: first.context }),
        ])
        expect(groups[0]!.members).toHaveLength(3)
        expect(groups[0]!.members.some(item => item.readAt === null)).toBe(true)
        expect(notificationChannels(groups[0]!).map(item => item.id)).toEqual(['a', 'b'])
    })
    test('formats outcome and bounded channel names in all four locales', () => {
        // cspell:disable
        const expected = {
            en: 'Published on Alpha, Beta, and 2 more',
            fr: 'Publié sur Alpha, Beta et 2 autres',
            es: 'Publicado en Alpha, Beta y 2 más',
            de: 'Veröffentlicht auf Alpha, Beta und 2 weiteren',
        }
        // cspell:enable
        for (const locale of ['en', 'fr', 'es', 'de'] as const) {
            expect<string>(
                notificationOutcomeCopy(
                    notification('a'),
                    notificationChannelSummary(['Alpha', 'Beta', 'Gamma', 'Delta'], locale),
                    locale
                )
            ).toBe(expected[locale])
            expect(notificationChannelSummary(['Alpha'], locale)).toBe('Alpha')
        }
    })
    test('uses relative time, a short older date and project civil days across DST', () => {
        expect(notificationTime(now - 300_000, 'Europe/Paris', 'en', now)).toBe('5 min. ago')
        expect(notificationTime(now - 300_000, 'Europe/Paris', 'fr', now)).toBe('il y a 5\u00a0min')
        expect(notificationTime(now - 8 * 86_400_000, 'UTC', 'en', now)).toContain('Nov')
        const midnight = Date.UTC(2026, 10, 16, 0, 30)
        expect(notificationSection(midnight - 3_600_000, 'America/New_York', midnight)).toBe(
            'today'
        )
        expect(notificationSection(midnight - 3_600_000, 'UTC', midnight)).toBe('yesterday')
        expect(
            notificationSection(
                Date.UTC(2026, 9, 25, 0),
                'Europe/Paris',
                Date.UTC(2026, 9, 25, 23, 30)
            )
        ).toBe('yesterday')
    })
})
