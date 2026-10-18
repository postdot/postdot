import { resolve } from 'node:path'

interface InlangSettings {
    baseLocale: string
    locales: string[]
}

interface MessageCatalog {
    [key: string]: unknown
}

interface LocaleCoverage {
    locale: string
    translated: number
    total: number
    coverage: number
    missing: string[]
    extra: string[]
    unchanged: string[]
    unapprovedUnchanged: string[]
}

const rootDirectory = resolve(import.meta.dir, '..')
const webDirectory = resolve(rootDirectory, 'apps/web')
const settingsPath = resolve(webDirectory, 'project.inlang/settings.json')
const messagesDirectory = resolve(webDirectory, 'messages')
const allowedUnchangedByLocale = new Map<string, ReadonlySet<string>>([
    [
        'fr',
        new Set([
            'access_project_access_direct',
            'access_project_access_via_group',
            'api_keys_expiration',
            'api_keys_active',
            'api_keys_actions_label',
            'calendar_event',
            'calendar_events',
            'calendar_view_agenda',
            'common_publication_count',
            'date_time_picker_date',
            'editor_markdown',
            'editor_target_compatible',
            'editor_target_null',
            'media_editor_aspect_portrait',
            'media_editor_aspect_source',
            'media_editor_rotation',
            'media_editor_zoom',
            'media_filter_audio',
            'media_filter_documents',
            'media_filter_images',
            'media_info_animation',
            'media_info_dimensions',
            'media_info_format',
            'media_info_pages',
            'media_info_type',
            'media_info_usage_publication',
            'media_retention_minutes',
            'media_source_url',
            'media_source_url_hint',
            'media_source_webcam',
            'media_supported_types',
            'nav_channel_tooltip',
            'nav_installation',
            'nav_instance',
            'nav_instance_settings',
            'nav_publications',
            'nav_workspace',
            'nav_workspace_settings',
            'notifications_title',
            'overview_publications',
            'provider_apps_active',
            'provider_apps_handle_resolver_placeholder',
            'provider_apps_name_placeholder',
            'provider_apps_provider',
            'provider_apps_provider_bluesky',
            'provider_apps_provider_linkedin',
            'provider_apps_provider_x',
            'provider_apps_provider_facebook',
            'provider_discord_channel_placeholder',
            'provider_endpoint_placeholder',
            'provider_header_name_placeholder',
            'provider_instance_placeholder',
            'publication_outcome_external_url_placeholder',
            'queue_column_action',
            'queue_column_destination',
            'queue_column_publication',
            'queue_filter_aria',
            'queue_publications',
            'realtime_db_option',
            'realtime_notification_created',
            'realtime_notification_read',
            'realtime_notifications',
            'realtime_publication_status_changed',
            'realtime_publication_updated',
            'realtime_publications',
            'realtime_query_option',
            'taxonomy_tags',
        ]),
    ],
])

const settings = (await Bun.file(settingsPath).json()) as InlangSettings
const baseCatalog = await readCatalog(settings.baseLocale)
const baseKeys = Object.keys(baseCatalog).toSorted()

if (baseKeys.length === 0) {
    throw new Error(`The base locale ${settings.baseLocale} has no messages`)
}

const reports = await Promise.all(settings.locales.map(locale => measureLocale(locale)))
const hasFailure = reports.some(
    report =>
        report.missing.length > 0 ||
        report.extra.length > 0 ||
        report.unapprovedUnchanged.length > 0
)

console.log(`i18n coverage (base locale: ${settings.baseLocale})`)
for (const report of reports) {
    console.log(
        `- ${report.locale}: ${formatPercentage(report.coverage)} ` +
            `(${report.translated}/${report.total} messages)`
    )

    if (report.missing.length > 0) {
        console.log(`  missing: ${report.missing.join(', ')}`)
    }

    if (report.extra.length > 0) {
        console.log(`  extra: ${report.extra.join(', ')}`)
    }

    if (report.unchanged.length > 0 && report.locale !== settings.baseLocale) {
        console.log(`  unchanged-as-base: ${report.unchanged.join(', ')}`)
    }

    if (report.unapprovedUnchanged.length > 0) {
        console.log(
            `  unchanged-as-base (not allowlisted): ${report.unapprovedUnchanged.join(', ')}`
        )
    }
}

if (hasFailure) {
    throw new Error('Localization catalogs are incomplete or contain unknown message keys')
}

console.log('i18n coverage passed')

async function measureLocale(locale: string): Promise<LocaleCoverage> {
    const catalog = await readCatalog(locale)
    const keys = Object.keys(catalog).toSorted()
    const keySet = new Set(keys)
    const missing = baseKeys.filter(key => !keySet.has(key) || isEmptyMessage(catalog[key]))
    const extra = keys.filter(key => !Object.hasOwn(baseCatalog, key))
    const translated = baseKeys.length - missing.length
    const unchanged =
        locale === settings.baseLocale
            ? []
            : baseKeys.filter(
                  key =>
                      !missing.includes(key) &&
                      serializeMessage(catalog[key]) === serializeMessage(baseCatalog[key])
              )
    const allowedUnchanged = allowedUnchangedByLocale.get(locale) ?? new Set<string>()
    const unapprovedUnchanged = unchanged.filter(key => !allowedUnchanged.has(key))

    return {
        locale,
        translated,
        total: baseKeys.length,
        coverage: translated / baseKeys.length,
        missing,
        extra,
        unchanged,
        unapprovedUnchanged,
    }
}

async function readCatalog(locale: string): Promise<MessageCatalog> {
    const path = resolve(messagesDirectory, `${locale}.json`)
    const value = await Bun.file(path).json()

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Localization catalog must be a JSON object: ${path}`)
    }

    return value as MessageCatalog
}

function isEmptyMessage(value: unknown) {
    if (typeof value === 'string') return value.trim().length === 0
    if (!Array.isArray(value)) return true
    return value.length === 0
}

function formatPercentage(value: number) {
    return `${(value * 100).toFixed(2)}%`
}

function serializeMessage(value: unknown) {
    return typeof value === 'string' ? value : JSON.stringify(value)
}
