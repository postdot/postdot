import { describe, expect, test } from 'bun:test'

import type { ChannelListItem, ProviderAnalyticsItem, PublicationSummary } from '@/lib/api'
import {
    performanceExportHeaders,
    readPerformanceCsv,
    type PerformanceExportReader,
} from '@/lib/publication-performance-export'

const projectId = 'project-1'
const exportedAt = 1_700_000_000_000

type PublicationPage = Awaited<ReturnType<PerformanceExportReader['listPublications']>>
type AnalyticsPage = Awaited<
    ReturnType<PerformanceExportReader['listLatestBlueskyProviderAnalytics']>
>

function channel(id: string, overrides: Partial<ChannelListItem> = {}): ChannelListItem {
    return {
        execution: { kind: 'built_in', contractId: 'bluesky' },
        id,
        name: `${id} channel`,
        profileId: 'bluesky',
        ...overrides,
    } as ChannelListItem
}

function publication(id: string, overrides: Partial<PublicationSummary> = {}): PublicationSummary {
    return {
        channelId: 'channel-bluesky',
        channelName: `${id} channel`,
        externalId: `${id}-external`,
        externalUrl: `https://example.test/${id}`,
        id,
        postId: `post-${id}`,
        postTitle: `${id} title`,
        publishedAt: 1_700_000_000_000,
        state: 'published',
        ...overrides,
    } as PublicationSummary
}

function observation(
    id: string,
    publicationId: string,
    metricName: string,
    overrides: Partial<ProviderAnalyticsItem> = {}
): ProviderAnalyticsItem {
    return {
        aggregation: 'snapshot',
        availability: 'measured',
        fetchedAt: 1_700_000_000_000,
        freshness: 'fresh',
        id,
        metricName,
        observedAt: 1_699_000_000_000,
        postbotEntityId: publicationId,
        postbotEntityType: 'publication',
        projectId,
        provider: 'bluesky',
        subjectType: 'content',
        unit: 'count',
        value: 3,
        ...overrides,
    } as ProviderAnalyticsItem
}

function publicationPage(
    publications: PublicationSummary[],
    nextCursor: string | null = null
): PublicationPage {
    return {
        nextCursor,
        publications,
        summary: {
            automatic: publications.length,
            draft: 0,
            manual: 0,
            scheduled: 0,
            total: publications.length,
        },
    } as PublicationPage
}

function analyticsPage(
    provider: string,
    observations: ProviderAnalyticsItem[],
    overrides: Partial<AnalyticsPage> = {}
): AnalyticsPage {
    return {
        contractVersion: 1,
        hasMore: false,
        limit: 25,
        observations,
        projectId,
        provider,
        ...overrides,
    } as AnalyticsPage
}

function createReader(overrides: Partial<PerformanceExportReader> = {}): PerformanceExportReader {
    return {
        listPublications: overrides.listPublications ?? (async () => publicationPage([])),
        listLatestBlueskyProviderAnalytics:
            overrides.listLatestBlueskyProviderAnalytics ??
            (async () => analyticsPage('bluesky', [])),
        listLatestDevtoProviderAnalytics:
            overrides.listLatestDevtoProviderAnalytics ?? (async () => analyticsPage('devto', [])),
        listLatestMastodonProviderAnalytics:
            overrides.listLatestMastodonProviderAnalytics ??
            (async () => analyticsPage('mastodon', [])),
    }
}

/** Read the exported document back into cells and records. */
function csvRows(csv: string): string[][] {
    const body = csv.startsWith('\uFEFF') ? csv.slice(1) : csv
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let index = 0; index < body.length; index += 1) {
        const character = body[index]!
        if (quoted) {
            if (character === '"') {
                if (body[index + 1] === '"') {
                    cell += '"'
                    index += 1
                    continue
                }
                quoted = false
                continue
            }
            cell += character
            continue
        }
        if (character === '"') {
            quoted = true
            continue
        }
        if (character === ',') {
            row.push(cell)
            cell = ''
            continue
        }
        if (character === '\r' && body[index + 1] === '\n') {
            row.push(cell)
            rows.push(row)
            row = []
            cell = ''
            index += 1
            continue
        }
        cell += character
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell)
        rows.push(row)
    }
    return rows
}

function csvRecords(csv: string): Record<string, string>[] {
    const [header, ...body] = csvRows(csv)
    return body.map(row =>
        Object.fromEntries((header ?? []).map((name, index) => [name, row[index] ?? '']))
    )
}

describe('performance CSV export', () => {
    test('reads every publication page and keeps each destination once', async () => {
        const requests: {
            cursor?: string
            limit?: number
            sort?: string
            tagIds?: readonly string[]
        }[] = []
        const reader = createReader({
            listPublications: async (_projectId, options) => {
                requests.push({
                    cursor: options?.cursor,
                    limit: options?.limit,
                    sort: options?.sort,
                    tagIds: options?.tagIds,
                })
                if (options?.cursor === undefined) {
                    return publicationPage(
                        [
                            publication('publication-1'),
                            publication('publication-draft', { state: 'draft' }),
                        ],
                        'cursor-1'
                    )
                }
                return publicationPage([publication('publication-1'), publication('publication-2')])
            },
        })

        const csv = await readPerformanceCsv(
            {
                projectId,
                tagIds: ['tag-b', 'tag-a', 'tag-b'],
                channels: [channel('channel-bluesky')],
                exportedAt,
            },
            reader
        )

        expect(requests).toHaveLength(2)
        expect(requests[0]).toEqual({
            cursor: undefined,
            limit: 100,
            sort: 'updated_desc',
            tagIds: ['tag-a', 'tag-b'],
        })
        expect(requests[1]?.cursor).toBe('cursor-1')

        const records = csvRecords(csv)
        expect(records).toHaveLength(10)
        expect([...new Set(records.map(record => record.publication_id))]).toEqual([
            'publication-1',
            'publication-2',
        ])
        expect(records.every(record => record.selected_tag_ids === 'tag-a;tag-b')).toBe(true)
        expect(records.every(record => record.exported_at === '2023-11-14T22:13:20.000Z')).toBe(
            true
        )
        expect(csv.startsWith('\uFEFF')).toBe(true)
        expect(csv.includes('\r\n')).toBe(true)
        expect(csvRows(csv)[0]).toEqual([...performanceExportHeaders])
    })

    test('keeps paging through an empty page', async () => {
        const cursors: (string | undefined)[] = []
        const reader = createReader({
            listPublications: async (_projectId, options) => {
                cursors.push(options?.cursor)
                return options?.cursor === undefined
                    ? publicationPage([], 'cursor-1')
                    : publicationPage([publication('publication-1')])
            },
        })

        const records = csvRecords(
            await readPerformanceCsv(
                {
                    projectId,
                    tagIds: [],
                    channels: [channel('channel-bluesky')],
                    exportedAt,
                },
                reader
            )
        )

        expect(cursors).toEqual([undefined, 'cursor-1'])
        expect(records).toHaveLength(5)
        expect(records.every(record => record.publication_id === 'publication-1')).toBe(true)
    })

    test('splits each provider read within the batch bound and keeps the providers apart', async () => {
        const blueskyCalls: (readonly string[])[] = []
        const devtoCalls: (readonly string[])[] = []
        const mastodonCalls: (readonly string[])[] = []
        const channels = [
            channel('channel-bluesky'),
            channel('channel-devto', { profileId: 'devto' }),
            channel('channel-mastodon', {
                execution: { kind: 'built_in', contractId: 'mastodon' },
                profileId: 'mastodon',
            }),
        ]
        const publications = [
            ...Array.from({ length: 26 }, (_, index) =>
                publication(`publication-bluesky-${index}`)
            ),
            publication('publication-devto', { channelId: 'channel-devto' }),
            publication('publication-mastodon', { channelId: 'channel-mastodon' }),
        ]
        const reader = createReader({
            listPublications: async () => publicationPage(publications),
            listLatestBlueskyProviderAnalytics: async (_projectId, publicationIds) => {
                blueskyCalls.push(publicationIds)
                return analyticsPage('bluesky', [])
            },
            listLatestDevtoProviderAnalytics: async (_projectId, publicationIds) => {
                devtoCalls.push(publicationIds)
                return analyticsPage('devto', [
                    observation('devto-like', 'publication-devto', 'page_views', {
                        provider: 'devto',
                        value: 12,
                    }),
                    observation('devto-foreign', 'publication-bluesky-0', 'page_views', {
                        provider: 'devto',
                    }),
                ])
            },
            listLatestMastodonProviderAnalytics: async (_projectId, publicationIds) => {
                mastodonCalls.push(publicationIds)
                return analyticsPage('mastodon', [])
            },
        })

        const records = csvRecords(
            await readPerformanceCsv({ projectId, tagIds: [], channels }, reader)
        )

        expect(blueskyCalls.map(call => call.length)).toEqual([25, 1])
        expect(devtoCalls).toEqual([['publication-devto']])
        expect(mastodonCalls).toEqual([['publication-mastodon']])

        const devtoRow = records.find(
            record =>
                record.publication_id === 'publication-devto' && record.metric_name === 'page_views'
        )
        expect(devtoRow?.value).toBe('12')
        expect(devtoRow?.provider).toBe('devto')

        const foreignRow = records.find(
            record =>
                record.publication_id === 'publication-bluesky-0' &&
                record.metric_name === 'likeCount'
        )
        expect(foreignRow?.availability).toBe('not_collected')
        expect(foreignRow?.value).toBe('')
    })

    test('keeps a measured zero, an unavailable metric and a missing metric apart', async () => {
        const reader = createReader({
            listPublications: async () => publicationPage([publication('publication-1')]),
            listLatestBlueskyProviderAnalytics: async () =>
                analyticsPage('bluesky', [
                    observation('like', 'publication-1', 'likeCount', { value: 0 }),
                    observation('repost', 'publication-1', 'repostCount', {
                        availability: 'not_found',
                        value: null,
                    }),
                ]),
        })

        const records = csvRecords(
            await readPerformanceCsv(
                {
                    projectId,
                    tagIds: [],
                    channels: [channel('channel-bluesky')],
                    exportedAt,
                },
                reader
            )
        )

        const like = records.find(record => record.metric_name === 'likeCount')
        expect(like?.value).toBe('0')
        expect(like?.availability).toBe('measured')
        expect(like?.unit).toBe('count')
        expect(like?.aggregation).toBe('snapshot')
        expect(like?.freshness).toBe('fresh')
        expect(like?.observed_at).toBe('2023-11-03T08:26:40.000Z')
        expect(like?.fetched_at).toBe('2023-11-14T22:13:20.000Z')

        const repost = records.find(record => record.metric_name === 'repostCount')
        expect(repost?.value).toBe('')
        expect(repost?.availability).toBe('not_found')

        const quote = records.find(record => record.metric_name === 'quoteCount')
        expect(quote?.value).toBe('')
        expect(quote?.availability).toBe('not_collected')
        expect(quote?.unit).toBe('')
        expect(quote?.aggregation).toBe('')
        expect(quote?.freshness).toBe('')
        expect(quote?.observed_at).toBe('')
        expect(quote?.fetched_at).toBe('')
    })

    test('quotes every cell and keeps a text cell from reading as a formula', async () => {
        const reader = createReader({
            listPublications: async () =>
                publicationPage([
                    publication('publication-1', {
                        channelName: '@news, weekly',
                        externalId: '\ncontrol-prefix',
                        postTitle: '=SUM(A1) "quoted"\nsecond line',
                    }),
                ]),
            listLatestBlueskyProviderAnalytics: async () =>
                analyticsPage('bluesky', [
                    observation('like', 'publication-1', 'likeCount', { value: -5 }),
                ]),
        })

        const csv = await readPerformanceCsv(
            {
                projectId,
                tagIds: [],
                channels: [channel('channel-bluesky')],
                exportedAt,
            },
            reader
        )

        const records = csvRecords(csv)
        expect(records[0]?.post_title).toBe('\'=SUM(A1) "quoted"\nsecond line')
        expect(records[0]?.channel_name).toBe("'@news, weekly")
        expect(records[0]?.external_id).toBe("'\ncontrol-prefix")
        expect(records[0]?.value).toBe('-5')
        expect(csv).toContain('"\'=SUM(A1) ""quoted""\nsecond line"')
    })

    test('fails the export when a stored read is incomplete or incorrectly routed', async () => {
        const channels = [channel('channel-bluesky')]
        const options = { projectId, tagIds: [], channels, exportedAt }

        await expect(
            readPerformanceCsv(
                options,
                createReader({
                    listPublications: async () => publicationPage([publication('publication-1')]),
                    listLatestBlueskyProviderAnalytics: async () =>
                        analyticsPage('bluesky', [], { hasMore: true }),
                })
            )
        ).rejects.toThrow(/truncated/)

        await expect(
            readPerformanceCsv(
                options,
                createReader({
                    listPublications: async () => publicationPage([publication('publication-1')]),
                    listLatestBlueskyProviderAnalytics: async () =>
                        analyticsPage('bluesky', [], { projectId: 'project-2' }),
                })
            )
        ).rejects.toThrow(/another project/)

        await expect(
            readPerformanceCsv(
                options,
                createReader({
                    listPublications: async () => publicationPage([publication('publication-1')]),
                    listLatestBlueskyProviderAnalytics: async () => analyticsPage('devto', []),
                })
            )
        ).rejects.toThrow(/another provider/)

        await expect(
            readPerformanceCsv(
                options,
                createReader({
                    listPublications: async () => {
                        throw new Error('The publication read failed.')
                    },
                })
            )
        ).rejects.toThrow(/publication read failed/)
    })

    test('fails the export when the caller cancels it', async () => {
        const controller = new AbortController()
        controller.abort()
        const channels = [channel('channel-bluesky')]

        const cancelled = await readPerformanceCsv(
            { projectId, tagIds: [], channels, signal: controller.signal },
            createReader({
                listPublications: async () => publicationPage([publication('publication-1')]),
            })
        ).catch((error: unknown) => error)
        expect(cancelled).toBeInstanceOf(DOMException)
        expect((cancelled as DOMException).name).toBe('AbortError')

        const running = new AbortController()
        const interrupted = await readPerformanceCsv(
            { projectId, tagIds: [], channels, signal: running.signal },
            createReader({
                listPublications: async () => {
                    running.abort()
                    return publicationPage([publication('publication-1')])
                },
            })
        ).catch((error: unknown) => error)
        expect(interrupted).toBeInstanceOf(DOMException)
        expect((interrupted as DOMException).name).toBe('AbortError')
    })

    test('fails the export when a publication cursor repeats itself', async () => {
        const reader = createReader({
            listPublications: async (_projectId, options) =>
                options?.cursor === undefined
                    ? publicationPage([publication('publication-1')], 'cursor-1')
                    : publicationPage([publication('publication-2')], 'cursor-1'),
        })

        await expect(
            readPerformanceCsv(
                {
                    projectId,
                    tagIds: [],
                    channels: [channel('channel-bluesky')],
                    exportedAt,
                },
                reader
            )
        ).rejects.toThrow(/cursor/)
    })
})
