import { describe, expect, it } from 'bun:test'

import { closeDatabase, createDatabase } from './client'
import { createManualStore } from './manual-store'
import { runMigrations } from './migrations'
import { createProviderAnalyticsStore } from './provider-analytics-store'
import { seedTestWorkspace } from './testing'

const now = 1_800_000_000_000
const did = 'did:plc:provider-analytics'

function observation(
    projectId: string,
    fetchedAt: number,
    value: number | null = 0,
    availability: 'measured' | 'not_reported' | 'partial_response' = value === null
        ? 'not_reported'
        : 'measured'
) {
    return {
        projectId,
        provider: 'bluesky',
        subjectType: 'account' as const,
        providerSubjectId: did,
        providerSubjectLabel: 'analytics.test',
        providerContentRevisionId: null,
        postdotEntityType: 'channel' as const,
        postdotEntityId: 'channel-1',
        metricName: 'followersCount',
        value,
        unit: 'count',
        aggregation: 'cumulative_snapshot',
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
        observedAt: null,
        fetchedAt,
        availability,
        freshness: 'unknown' as const,
        provenance: 'bluesky.public-api.v1',
    }
}

describe('provider analytics store', () => {
    it('records immutable snapshots, deduplicates a repeated fetch, and isolates projects', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const manual = createManualStore(database, { now: () => now })
            const first = manual.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'First analytics project',
                subjectId: 'user-1',
                displayName: 'First operator',
            })
            const second = manual.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Second analytics project',
                subjectId: 'user-2',
                displayName: 'Second operator',
            })
            const store = createProviderAnalyticsStore(database, {
                createId: (() => {
                    let sequence = 0
                    return () => 'observation-' + ++sequence
                })(),
            })

            const firstFetch = store.recordObservations({
                projectId: first.project.id,
                subjectId: 'user-1',
                observations: [observation(first.project.id, now, 0)],
            })
            const duplicateFetch = store.recordObservations({
                projectId: first.project.id,
                subjectId: 'user-1',
                observations: [observation(first.project.id, now, 0)],
            })
            const secondSnapshot = store.recordObservations({
                projectId: first.project.id,
                subjectId: 'user-1',
                observations: [observation(first.project.id, now + 1_000, null)],
            })
            const partialSnapshot = store.recordObservations({
                projectId: first.project.id,
                subjectId: 'user-1',
                observations: [
                    observation(first.project.id, now + 2_000, null, 'partial_response'),
                ],
            })

            expect(firstFetch).toMatchObject({ inserted: 1, duplicates: 0 })
            expect(duplicateFetch).toMatchObject({ inserted: 0, duplicates: 1 })
            expect(secondSnapshot).toMatchObject({ inserted: 1, duplicates: 0 })
            expect(secondSnapshot?.observations[0]).toMatchObject({
                value: null,
                availability: 'not_reported',
                fetchedAt: now + 1_000,
            })
            expect(partialSnapshot).toMatchObject({ inserted: 1, duplicates: 0 })
            expect(partialSnapshot?.observations[0]).toMatchObject({
                availability: 'partial_response',
                value: null,
                fetchedAt: now + 2_000,
            })

            const listed = store.listObservations({
                projectId: first.project.id,
                subjectId: 'user-1',
                provider: 'bluesky',
            })
            expect(listed?.observations).toHaveLength(3)
            expect(listed?.observations.map(item => item.fetchedAt)).toEqual([
                now + 2_000,
                now + 1_000,
                now,
            ])
            expect(
                store.listObservations({
                    projectId: first.project.id,
                    subjectId: 'user-2',
                    provider: 'bluesky',
                })
            ).toBeNull()
            expect(
                store.listObservations({
                    projectId: second.project.id,
                    subjectId: 'user-2',
                    provider: 'bluesky',
                })
            ).toMatchObject({ observations: [] })
        } finally {
            closeDatabase(database)
        }
    })

    it('reads latest metrics before applying the cap and isolates selected publication histories', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const manual = createManualStore(database, { now: () => now })
            const { project } = manual.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Latest reports',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const foreign = manual.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Other project',
                subjectId: 'user-2',
                displayName: 'Other operator',
            })
            let sequence = 0
            const store = createProviderAnalyticsStore(database, {
                createId: () => 'row-' + String(++sequence).padStart(6, '0'),
            })
            const content = (
                publicationId: string,
                fetchedAt: number,
                value: number | null = 0
            ) => ({
                ...observation(project.id, fetchedAt, value),
                subjectType: 'content' as const,
                postdotEntityType: 'publication' as const,
                postdotEntityId: publicationId,
                providerSubjectId: 'at://did:plc:report/app.bsky.feed.post/' + publicationId,
                metricName: 'likeCount',
            })
            store.recordObservations({
                projectId: project.id,
                subjectId: 'user-1',
                observations: [
                    content('older-publication', now, 0),
                    ...Array.from({ length: 510 }, (_, i) =>
                        content('busy-publication', now + i + 1, i)
                    ),
                ],
            })
            store.recordObservations({
                projectId: project.id,
                subjectId: 'user-1',
                observations: [
                    content('busy-publication', now + 1000, null),
                    {
                        ...content('busy-publication', now + 1000, 5),
                        providerSubjectId: 'replacement-identity',
                    },
                ],
            })
            const input = {
                projectId: project.id,
                subjectId: 'user-1',
                provider: 'bluesky',
                publicationIds: ['older-publication', 'busy-publication'],
            }
            const result = store.listLatestContentObservations(input)
            expect(result?.hasMore).toBe(false)
            expect(result?.observations).toHaveLength(2)
            expect(
                result?.observations.find(row => row.postdotEntityId === 'older-publication')?.value
            ).toBe(0)
            expect(
                result?.observations.find(row => row.postdotEntityId === 'busy-publication')?.value
            ).toBe(5)
            store.recordObservations({
                projectId: project.id,
                subjectId: 'user-1',
                observations: [content('busy-publication', now + 2000, null)],
            })
            expect(store.listLatestContentObservations(input)?.observations[0]).toMatchObject({
                value: null,
                availability: 'not_reported',
            })
            expect(
                store.listLatestContentObservations({ ...input, subjectId: 'user-2' })
            ).toBeNull()
            expect(
                store.listLatestContentObservations({
                    ...input,
                    projectId: foreign.project.id,
                    subjectId: 'user-2',
                })?.observations
            ).toEqual([])
            expect(() =>
                store.listLatestContentObservations({ ...input, publicationIds: [] })
            ).toThrow()
            expect(() =>
                store.listLatestContentObservations({ ...input, publicationIds: ['same', 'same'] })
            ).toThrow()
            expect(() =>
                store.listLatestContentObservations({
                    ...input,
                    publicationIds: Array.from({ length: 26 }, (_, i) => String(i)),
                })
            ).toThrow()
        } finally {
            closeDatabase(database)
        }
    })

    it('lists only known provider publications and never discovers account content', () => {
        const database = createDatabase(':memory:')
        try {
            runMigrations(database)
            const manual = createManualStore(database, { now: () => now })
            const project = manual.createProject({
                workspaceId: seedTestWorkspace(database),
                name: 'Known content project',
                subjectId: 'user-1',
                displayName: 'Operator',
            })
            const channel = manual.createChannel({
                projectId: project.project.id,
                subjectId: 'user-1',
                name: 'Bluesky',
            })
            if (channel === null) throw new Error('The test channel is missing')
            const created = manual.createPost({
                projectId: project.project.id,
                subjectId: 'user-1',
                sourceContent: {
                    body: { text: 'Known provider content', format: 'plain_text' },
                    media: [],
                },
                publications: [{ channelId: channel.id }],
            })
            if (created === null) throw new Error('The test publication is missing')
            const publicationId = created.publications[0]?.id
            if (publicationId === undefined) throw new Error('The publication ID is missing')

            database.$client
                .query(
                    'insert into publishers (id, workspace_id, channel_id, kind, created_at, updated_at) ' +
                        "values (?1, (select workspace_id from projects where id = ?2), ?3, 'bluesky', ?4, ?4)"
                )
                .run('publisher-1', project.project.id, channel.id, now)
            database.$client
                .query('update publications set external_id = ?1 where id = ?2')
                .run('at://did:plc:provider-analytics/app.bsky.feed.post/3known', publicationId)

            const store = createProviderAnalyticsStore(database)
            expect(
                store.listKnownProviderContent({
                    projectId: project.project.id,
                    subjectId: 'user-1',
                    provider: 'bluesky',
                    channelId: channel.id,
                })
            ).toEqual([
                {
                    channelId: channel.id,
                    postdotEntityType: 'publication',
                    postdotEntityId: publicationId,
                    providerSubjectId: 'at://did:plc:provider-analytics/app.bsky.feed.post/3known',
                    providerSubjectLabel: null,
                },
            ])
        } finally {
            closeDatabase(database)
        }
    })
})
