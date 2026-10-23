import type { api, ChannelListItem, ProviderAnalyticsItem, PublicationSummary } from '@/lib/api'
import {
    createPerformanceProviderBatches,
    groupLatestObservations,
    normalizePerformanceTagSelection,
    performanceProviderForChannel,
    type PerformanceProvider,
    type PerformanceProviderBatch,
} from '@/lib/publication-performance'
import type { ProviderAnalyticsPage } from '@/providers/contract'
import { providerRegistry } from '@/providers/registry'

/**
 * The reads the export needs.
 *
 * The export owns the document shape only. The caller supplies the API client,
 * the download and the user-facing state, so the helper never reaches for a
 * global, a network call or a browser API on its own.
 */
export type PerformanceExportReader = Pick<
    typeof api,
    | 'listPublications'
    | 'listLatestBlueskyProviderAnalytics'
    | 'listLatestDevtoProviderAnalytics'
    | 'listLatestMastodonProviderAnalytics'
> &
    Partial<typeof api>

export interface PerformanceCsvExportOptions {
    readonly projectId: string
    readonly tagIds: readonly string[]
    readonly channels: readonly ChannelListItem[]
    readonly signal?: AbortSignal
    readonly exportedAt?: number
}

/**
 * The columns of the export, in their stable order.
 *
 * The names are English machine keys: a spreadsheet or a script reads them
 * without translating anything.
 */
export const performanceExportHeaders = [
    'exported_at',
    'project_id',
    'selected_tag_ids',
    'post_id',
    'post_title',
    'publication_id',
    'channel_id',
    'channel_name',
    'provider',
    'published_at',
    'external_id',
    'external_url',
    'metric_name',
    'value',
    'unit',
    'aggregation',
    'availability',
    'freshness',
    'observed_at',
    'fetched_at',
] as const

/**
 * The metrics a destination is expected to report.
 *
 * A destination always produces one row per expected metric, so an absent
 * observation stays visible as a gap instead of disappearing from the export.
 */

/** The publication read bound already used by the Performance page. */
const publicationPageSize = 100

/** The availability written for a metric that was never collected. */
const notCollectedAvailability = 'not_collected'

/** The byte order mark a spreadsheet expects in front of a UTF-8 CSV. */
const utf8ByteOrderMark = '\uFEFF'

type PerformanceExportPage = ProviderAnalyticsPage

interface PerformanceExportPublication {
    readonly publication: PublicationSummary
    readonly provider: PerformanceProvider
}

interface PerformanceExportCell {
    readonly text: string
    /** A measured number stays a raw number instead of a neutralized text. */
    readonly numeric?: boolean
}

/**
 * Read the Performance table of a project as a CSV document.
 *
 * Every row describes one stored metric of one published destination. The
 * export never aggregates, never invents a value and never summarizes a
 * missing observation: an uncollected metric is reported as such.
 */
export async function readPerformanceCsv(
    options: PerformanceCsvExportOptions,
    reader: PerformanceExportReader
): Promise<string> {
    const exportedAt = options.exportedAt ?? Date.now()
    const selectedTagIds = normalizePerformanceTagSelection(options.tagIds)
    const channelsById = new Map(options.channels.map(channel => [channel.id, channel]))

    const publications = await readSelectedPublications(
        options,
        reader,
        channelsById,
        selectedTagIds
    )
    const batches = createPerformanceProviderBatches(
        publications.map(entry => ({
            publicationId: entry.publication.id,
            provider: entry.provider,
        }))
    )

    const observations: ProviderAnalyticsItem[] = []
    for (const batch of batches) {
        const page = await readProviderBatch(options, reader, batch)
        observations.push(
            ...page.observations.filter(observation =>
                belongsToBatch(observation, options.projectId, batch)
            )
        )
    }
    const grouped = groupLatestObservations(observations)

    const rows: PerformanceExportCell[][] = []
    for (const entry of publications) {
        const publication = entry.publication
        const metrics = grouped.get(publication.id)
        const expectedMetrics = providerRegistry.get(entry.provider)?.analytics?.metrics
        if (!expectedMetrics) throw new Error('Provider analytics capability is unavailable')
        for (const { key: metricName } of expectedMetrics) {
            rows.push(
                buildRow({
                    exportedAt,
                    projectId: options.projectId,
                    selectedTagIds: selectedTagIds.join(';'),
                    publication,
                    provider: entry.provider,
                    metricName,
                    observation: metrics?.get(metricName),
                })
            )
        }
    }

    return serializeCsv(rows)
}

/**
 * Read every publication page and keep the published destinations that report
 * provider metrics.
 *
 * A publication may appear on more than one page, so an identifier is read
 * once. A cursor that comes back twice would page forever, so it fails the
 * export instead.
 */
async function readSelectedPublications(
    options: PerformanceCsvExportOptions,
    reader: PerformanceExportReader,
    channelsById: ReadonlyMap<string, ChannelListItem>,
    selectedTagIds: readonly string[]
): Promise<readonly PerformanceExportPublication[]> {
    const seenPublicationIds = new Set<string>()
    const seenCursors = new Set<string>()
    const selected: PerformanceExportPublication[] = []
    let cursor: string | undefined

    for (;;) {
        throwIfCancelled(options.signal)
        if (cursor !== undefined) {
            if (seenCursors.has(cursor)) {
                throw new Error(
                    'The publication read returned a cursor it already used, so the export cannot continue.'
                )
            }
            seenCursors.add(cursor)
        }

        const request: NonNullable<Parameters<PerformanceExportReader['listPublications']>[1]> = {
            limit: publicationPageSize,
            sort: 'updated_desc',
            ...(cursor === undefined ? {} : { cursor }),
            ...(selectedTagIds.length > 0 ? { tagIds: selectedTagIds } : {}),
        }
        const page = await reader.listPublications(options.projectId, request)
        throwIfCancelled(options.signal)

        for (const publication of page.publications) {
            if (seenPublicationIds.has(publication.id)) continue
            seenPublicationIds.add(publication.id)
            if (publication.state !== 'published') continue
            const provider = performanceProviderForChannel(channelsById.get(publication.channelId))
            if (provider === null) continue
            selected.push({ publication, provider })
        }

        const nextCursor = page.nextCursor
        if (typeof nextCursor !== 'string' || nextCursor.length === 0) return selected
        cursor = nextCursor
    }
}

/**
 * Read the latest observations of one provider batch.
 *
 * A truncated, incorrectly routed or failed read would silently drop stored metrics,
 * so it fails the whole export.
 */
async function readProviderBatch(
    options: PerformanceCsvExportOptions,
    reader: PerformanceExportReader,
    batch: PerformanceProviderBatch
): Promise<PerformanceExportPage> {
    throwIfCancelled(options.signal)
    const page = await readLatestProviderAnalytics(
        reader,
        batch.provider,
        options.projectId,
        batch.publicationIds
    )
    throwIfCancelled(options.signal)

    if (page.projectId !== options.projectId) {
        throw new Error(`The ${batch.provider} analytics read answered for another project.`)
    }
    if (page.provider !== batch.provider) {
        throw new Error(`The ${batch.provider} analytics read answered for another provider.`)
    }
    if (page.hasMore) {
        throw new Error(
            `The ${batch.provider} analytics read was truncated before every stored metric was read.`
        )
    }
    return page
}

function readLatestProviderAnalytics(
    reader: PerformanceExportReader,
    provider: PerformanceProvider,
    projectId: string,
    publicationIds: readonly string[]
): Promise<PerformanceExportPage> {
    const capability = providerRegistry.get(provider)?.analytics
    if (!capability) throw new Error('Provider analytics capability is unavailable')
    return capability.listLatest(reader, projectId, publicationIds)
}

/**
 * Keep only the observations that belong to the exported project, provider and
 * publications.
 *
 * Account rows, another provider's metrics and unrelated entities never reach
 * the export.
 */
function belongsToBatch(
    observation: ProviderAnalyticsItem,
    projectId: string,
    batch: PerformanceProviderBatch
): boolean {
    return (
        observation.projectId === projectId &&
        observation.provider === batch.provider &&
        observation.postbotEntityType === 'publication' &&
        observation.postbotEntityId !== null &&
        batch.publicationIds.includes(observation.postbotEntityId)
    )
}

function buildRow(context: {
    readonly exportedAt: number
    readonly projectId: string
    readonly selectedTagIds: string
    readonly publication: PublicationSummary
    readonly provider: PerformanceProvider
    readonly metricName: string
    readonly observation: ProviderAnalyticsItem | undefined
}): PerformanceExportCell[] {
    const { publication, observation } = context
    const measured = observation?.availability === 'measured' && observation.value !== null

    return [
        { text: isoDate(context.exportedAt) },
        { text: context.projectId },
        { text: context.selectedTagIds },
        { text: publication.postId },
        { text: publication.postTitle ?? '' },
        { text: publication.id },
        { text: publication.channelId },
        { text: publication.channelName },
        { text: context.provider },
        { text: isoDate(publication.publishedAt) },
        { text: publication.externalId ?? '' },
        { text: publication.externalUrl ?? '' },
        { text: context.metricName },
        measured ? { text: String(observation.value), numeric: true } : { text: '' },
        { text: observation?.unit ?? '' },
        { text: observation?.aggregation ?? '' },
        { text: observation?.availability ?? notCollectedAvailability },
        { text: observation?.freshness ?? '' },
        { text: observation === undefined ? '' : isoDate(observation.observedAt) },
        { text: observation === undefined ? '' : isoDate(observation.fetchedAt) },
    ]
}

/**
 * Serialize the rows as a spreadsheet-ready document.
 *
 * Every cell is quoted, so a title may hold a quote, a comma or a line break
 * without breaking the document.
 */
function serializeCsv(rows: readonly PerformanceExportCell[][]): string {
    const lines = [
        performanceExportHeaders.map(header => serializeCell({ text: header })).join(','),
        ...rows.map(row => row.map(cell => serializeCell(cell)).join(',')),
    ]
    return `${utf8ByteOrderMark}${lines.join('\r\n')}\r\n`
}

function serializeCell(cell: PerformanceExportCell): string {
    const text = cell.numeric === true ? cell.text : neutralizeFormulaPrefix(cell.text)
    return `"${text.replaceAll('"', '""')}"`
}

/**
 * Keep a text cell from being read as a formula.
 *
 * A spreadsheet starts a formula on `=`, `+`, `-` or `@`. Leading control
 * characters need the same protection. A measured number keeps its raw value,
 * so a negative metric stays a number.
 */
function neutralizeFormulaPrefix(value: string): string {
    if (value.length === 0) return value
    if (value.charCodeAt(0) < 32) return `'${value}`
    const trimmed = value.replace(/^\s+/, '')
    if (trimmed.length === 0) return value
    const candidate = trimmed[0]!
    if (candidate === '=' || candidate === '+' || candidate === '-' || candidate === '@') {
        return `'${value}`
    }
    return value
}

/**
 * Write a timestamp as an ISO UTC date, and leave an absent date empty.
 */
function isoDate(timestamp: number | null | undefined): string {
    if (timestamp === null || timestamp === undefined) return ''
    if (!Number.isFinite(timestamp)) return ''
    return new Date(timestamp).toISOString()
}

/**
 * Stop the export when the caller cancelled it.
 *
 * The export fails as a whole: a cancelled run never returns a partial
 * document.
 */
function throwIfCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted !== true) return
    throw new DOMException('The performance export was cancelled.', 'AbortError')
}
