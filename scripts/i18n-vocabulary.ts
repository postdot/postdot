import { resolve } from 'node:path'

interface InlangSettings {
    baseLocale: string
    locales: string[]
}

export type MessageCatalog = Record<string, unknown>

export interface VocabularyViolation {
    locale: string
    key: string
    value: string
    matches: string[]
}

const rootDirectory = resolve(import.meta.dir, '..')
const webDirectory = resolve(rootDirectory, 'apps/web')
const settingsPath = resolve(webDirectory, 'project.inlang/settings.json')
const messagesDirectory = resolve(webDirectory, 'messages')

/* cspell:disable */
const BANNED_PATTERNS_BY_LOCALE: Record<string, readonly string[]> = {
    en: [
        'profiles?',
        'targets?',
        'payloads?',
        'contracts?',
        'revisions?',
        'rebas(?:e|ed|es|ing)',
        'promot(?:e|ed|es|ing|ions?)',
        'snapshots?',
        'runtimes?',
        'workers?',
        'reconcil(?:e|ed|es|ing|iation)',
        'claim(?:ed|ing|s|able)?',
        'graphemes?',
        'escape hatch(?:es)?',
        'json',
        'schemas?',
        'bindings?',
        'capabilit(?:y|ies)',
        'ambiguous',
        'outcomes?',
        'sources?',
        'destinations?',
        'instances?',
        'provider applications?',
        'oauth applications?',
        'mime',
        'weighted(?: characters?)?',
        'uncertain',
        'manual delivery',
        'due manual work',
        'overrides?',
        'queued',
        'compositions?',
    ],
    fr: [
        'profils?',
        'cibles?',
        'payloads?',
        'charges? utiles?',
        'contrats?',
        'r[eé]visions?',
        'rebas(?:e|er|[eé]e?s?|age)',
        'promouvoir',
        'promotions?',
        'promu(?:e|s|es)?',
        'instantan[eé]e?s?',
        'snapshots?',
        'runtimes?',
        'workers?',
        'r[eé]concili(?:er|[eé]e?s?|ation)',
        'r[eé]clam(?:er|[eé]e?s?)',
        'revendiqu(?:er|[eé]e?s?)',
        'graph[eè]mes?',
        'json',
        'sch[eé]mas?',
        'liaisons?',
        'bindings?',
        'capacit[eé]s?',
        'ambig(?:u|u[eë]s?|us)',
        'incertaine?s?',
        'sources?',
        'destinations?',
        'instances?',
        'applications? fournisseur',
        'applications? oauth',
        'mime',
        'workspaces?',
        'tags?',
        'caract[eè]res? pond[eé]r[eé]s?',
        'pond[eé]r[eé]e?s?',
        'surcharges?',
        'overrides?',
        'en file',
        'compositions?',
    ],
    es: [
        'perfiles?',
        'objetivos?',
        'destinos?',
        'payloads?',
        'cargas? [uú]tiles?',
        'contratos?',
        'revisiones',
        'revisi[oó]n\\s+de\\s+destino',
        '^\\s*revisi[oó]n\\s*$',
        'rebas(?:e|ar|ado|ada|ando)',
        'promover',
        'promociones?',
        'promoci[oó]n',
        'promovido(?:s|a|as)?',
        'instant[aá]neas?',
        'snapshots?',
        'runtimes?',
        'workers?',
        'reconcili(?:ar|ado|ada|aci[oó]n)',
        'reclam(?:ar|ado|ada)',
        'grafemas?',
        'json',
        'esquemas?',
        'vinculaciones?',
        'enlaces? de campo',
        'bindings?',
        'capacidades?',
        'ambigu[oa]s?',
        'inciert[oa]s?',
        'or[ií]genes',
        'origen',
        'fuentes?',
        'instancias?',
        'aplicaciones? de proveedor',
        'aplicaciones? del proveedor',
        'aplicaciones? oauth',
        'aplicaci[oó]n de proveedor',
        'aplicaci[oó]n del proveedor',
        'aplicaci[oó]n oauth',
        'mime',
        'workspaces?',
        'caracteres ponderados',
        'ponderad[oa]s?',
        'sustituciones?',
        'en cola',
        'composici[oó]n',
        'composiciones',
    ],
    de: [
        'profil(?:e|s|en)?',
        'kanalprofil(?:e|s|en)?',
        'profil[äa]nderung(?:en)?',
        'ziel(?:e|s|en|es)?',
        'zielinhalt(?:e|s|en)?',
        'zielvertrag',
        'zielfelder(?:n)?',
        'zielrevision(?:en)?',
        'zielauswirkung(?:en)?',
        'zielsicher(?:e|er|es|en)?',
        'payloads?',
        'bereitstellungs-payload',
        'vertr[aä]ge?',
        'kanalvertrag',
        'webhook-vertrag',
        'revision(?:en)?',
        'rebas(?:e|en|ed)',
        'hochstuf(?:e|en|ung|te)',
        'hochgestuft',
        'bef[oö]rder(?:n|t|ung)',
        'promotion',
        'snapshots?',
        'test-snapshot',
        'momentaufnahmen?',
        'runtimes?',
        'runtime-vertrag',
        'workers?',
        'abgleich(?:en)?',
        'abgeglichen',
        'beanspruch(?:en|t|ung)',
        'graphem(?:e|en)?',
        'json',
        'schem(?:a|ata|en)',
        'inhaltsschema',
        'schema-[a-zäöüß-]+',
        'bindings?',
        'feldverkn[uü]pfung(?:en)?',
        'verkn[uü]pfung(?:en)?',
        'f[aä]higkeit(?:en)?',
        'mehrdeutig(?:e|en|er|es)?',
        'ambig(?:e|en)?',
        'ungewiss(?:e|en|er|es)?',
        'quell(?:e|en|dokument|inhalt(?:e|en)?|beitrag|modus|text)',
        'wertequelle',
        'instanz(?:en)?',
        'instanzadministrator',
        'instanzbenutzer',
        'instanz-url',
        'instanz-ursprung',
        'anbieter-apps?',
        'anbieter-anwendung(?:en)?',
        'anbieteranwendung(?:en)?',
        'provider-apps?',
        'oauth-apps?',
        'oauth-anwendung(?:en)?',
        'mime',
        'mime-typen',
        'gewichtete(?: zeichen)?',
        'in die warteschlange eingereiht',
        'zusammensetzung(?:en)?',
        'workspaces?(?:-[a-zäöüß-]+)?',
    ],
}
/* cspell:enable */

/**
 * Explicit allowlist (`key -> reason`) for message keys whose use of a banned
 * term is legitimate under ADR-103 §1. Every entry requires a non-empty reason.
 */
export const VOCABULARY_ALLOWLIST = new Map<string, string>([
    ['account_profile', 'Account settings section legitimately names the user profile'],
    ['account_saved', 'Account settings confirmation legitimately refers to the user profile'],
    [
        'provider_apps_client_metadata_url_placeholder',
        'Example OAuth client metadata URL necessarily ends with .json',
    ],
    [
        'api_keys_action_manage_channels',
        'API-key capability label naming the API channel/profile permission',
    ],
    [
        'api_keys_action_administer_instance',
        'API-key capability label naming the API instance:admin permission',
    ],
    [
        'editor_field_devto_tag',
        'Refers to external DEV.to article tags rather than Studio internal tags',
    ],
    [
        'editor_field_devto_tags_duplicate',
        'Refers to external DEV.to article tags rather than Studio internal tags',
    ],
    [
        'search_aliases_account',
        'Hidden Cmd+K search keywords allowing users to find Account via familiar synonyms',
    ],
    [
        'search_aliases_provider_apps',
        'Hidden Cmd+K search keywords allowing users to find Platform setup via OAuth/provider terms',
    ],
    [
        'search_aliases_channels',
        'Hidden Cmd+K search keywords allowing users to find Channels via destination synonyms',
    ],
    [
        'search_aliases_workspace',
        'Hidden Cmd+K search keywords allowing DE users to find Workspace settings via "workspace"',
    ],
])

export function extractMessageStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (!Array.isArray(value)) return []

    const extracted: string[] = []
    for (const item of value) {
        if (
            item !== null &&
            typeof item === 'object' &&
            'match' in item &&
            item.match !== null &&
            typeof item.match === 'object'
        ) {
            for (const candidate of Object.values(item.match as Record<string, unknown>)) {
                if (typeof candidate === 'string') {
                    extracted.push(candidate)
                }
            }
        }
    }
    return extracted
}

export function stripPlaceholders(value: string): string {
    return value.replaceAll(/\{[^{}]+\}/g, ' ')
}

export function buildBannedTermRegex(locale: string): RegExp | null {
    const patterns = BANNED_PATTERNS_BY_LOCALE[locale]
    if (!patterns || patterns.length === 0) return null
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${patterns.join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
}

export function validateAllowlist(allowlist: ReadonlyMap<string, string>) {
    for (const [key, reason] of allowlist) {
        if (reason.trim().length === 0) {
            throw new Error(`Vocabulary allowlist entry "${key}" must include a non-empty reason`)
        }
    }
}

export function findVocabularyViolations(
    locale: string,
    catalog: MessageCatalog,
    allowlist: ReadonlyMap<string, string> = VOCABULARY_ALLOWLIST
): VocabularyViolation[] {
    validateAllowlist(allowlist)
    const regex = buildBannedTermRegex(locale)
    if (!regex) return []

    const violations: VocabularyViolation[] = []
    for (const [key, rawValue] of Object.entries(catalog)) {
        if (allowlist.has(key)) continue
        for (const text of extractMessageStrings(rawValue)) {
            const matches = stripPlaceholders(text).match(regex)
            if (matches && matches.length > 0) {
                violations.push({
                    locale,
                    key,
                    value: text,
                    matches: [...new Set(matches)],
                })
            }
        }
    }
    return violations
}

async function readCatalog(locale: string): Promise<MessageCatalog> {
    const path = resolve(messagesDirectory, `${locale}.json`)
    const value = await Bun.file(path).json()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Localization catalog must be a JSON object: ${path}`)
    }
    return value as MessageCatalog
}

async function main() {
    const settings = (await Bun.file(settingsPath).json()) as InlangSettings
    const allViolations: VocabularyViolation[] = []

    console.log(`i18n vocabulary (ADR-103 §1, base locale: ${settings.baseLocale})`)
    for (const locale of settings.locales) {
        const catalog = await readCatalog(locale)
        const violations = findVocabularyViolations(locale, catalog)
        allViolations.push(...violations)
        console.log(`- ${locale}: ${violations.length} violation(s)`)
        for (const violation of violations) {
            console.log(
                `  ${violation.key}: ${JSON.stringify(violation.value)} ` +
                    `[banned: ${violation.matches.join(', ')}]`
            )
        }
    }

    if (allViolations.length > 0) {
        throw new Error(
            `Studio catalogs contain ${allViolations.length} banned vocabulary occurrence(s) under ADR-103 §1`
        )
    }

    console.log(`i18n vocabulary passed (allowlist: ${VOCABULARY_ALLOWLIST.size} keys)`)
}

if (import.meta.main) {
    await main()
}
