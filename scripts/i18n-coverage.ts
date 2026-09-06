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
}

const rootDirectory = resolve(import.meta.dir, '..')
const webDirectory = resolve(rootDirectory, 'apps/web')
const settingsPath = resolve(webDirectory, 'project.inlang/settings.json')
const messagesDirectory = resolve(webDirectory, 'messages')

const settings = (await Bun.file(settingsPath).json()) as InlangSettings
const baseCatalog = await readCatalog(settings.baseLocale)
const baseKeys = Object.keys(baseCatalog).toSorted()

if (baseKeys.length === 0) {
    throw new Error(`The base locale ${settings.baseLocale} has no messages`)
}

const reports = await Promise.all(settings.locales.map(locale => measureLocale(locale)))
const hasFailure = reports.some(report => report.missing.length > 0 || report.extra.length > 0)

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
        console.log(`  unchanged-as-base (review): ${report.unchanged.join(', ')}`)
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
                  key => !missing.includes(key) && String(catalog[key]) === String(baseCatalog[key])
              )

    return {
        locale,
        translated,
        total: baseKeys.length,
        coverage: translated / baseKeys.length,
        missing,
        extra,
        unchanged,
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
    return typeof value !== 'string' || value.trim().length === 0
}

function formatPercentage(value: number) {
    return `${(value * 100).toFixed(2)}%`
}
