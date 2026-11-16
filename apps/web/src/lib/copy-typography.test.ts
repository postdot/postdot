import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const messagesDirectory = join(import.meta.dir, '../../messages')

interface Rule {
    name: string
    pattern: RegExp
}

function extractMessageStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) {
        const result: string[] = []
        for (const item of value) {
            if (
                item &&
                typeof item === 'object' &&
                'match' in item &&
                item.match &&
                typeof item.match === 'object'
            ) {
                for (const branch of Object.values(item.match as Record<string, unknown>)) {
                    if (typeof branch === 'string') result.push(branch)
                }
            }
        }
        return result
    }
    return []
}

function wholeWord(alternation: string): RegExp {
    return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, 'iu')
}

/* cspell:disable */
// Universal punctuation and formatting rules applied across all Studio locales.
const universalRules: readonly Rule[] = [
    // Owner rule (2026-11-16): people do not type em or en dashes; use a period, colon, comma or hyphen.
    { name: 'em or en dash', pattern: /[\u2013\u2014]/ },
    // Separate sentences instead of joining them with a semicolon.
    { name: 'semicolon sentence chain', pattern: /;\s/u },
    // Exclamation marks add artificial urgency to operational UI text.
    { name: 'exclamation mark', pattern: /[!¡]/u },
    // Decorative emojis do not belong in Studio product copy.
    { name: 'emoji', pattern: /\p{Extended_Pictographic}/u },
    // ASCII triple dots drift from the catalog typographic ellipsis (…).
    { name: 'ASCII ellipsis', pattern: /\.\.\./ },
    // Straight ASCII quotes and apostrophes break typographic consistency inside locales.
    { name: 'straight quote or apostrophe', pattern: /['"]/ },
]

// Explicit, high-precision deny-lists per locale for machine-written tics and register drift.
const localeRules: Record<string, readonly Rule[]> = {
    'en.json': [
        // Inflated SaaS clichés that pad copy without adding product information.
        {
            name: 'inflated wording',
            pattern: wholeWord(
                'seamless(?:ly)?|effortless(?:ly)?|robust|leverage|streamline|powerful|unlock|elevate|delve|crucial|comprehensive|utilize|facilitate'
            ),
        },
        // Chatty filler phrases that belong in support chat, not concise UI labels.
        {
            name: 'filler phrasing',
            pattern: wholeWord("feel free|don[’']t worry|note that|simply|easily|please"),
        },
    ],
    'fr.json': [
        // Inflated phrasing and English calques avoided in French Studio copy.
        {
            name: 'inflated wording or calque',
            pattern: wholeWord(
                'sans effort|fluide(?:ment)?|robuste|optimiser|puissante?s?|exploiter|débloquer|impactante?s?|impacter|en temps réel'
            ),
        },
        // Unneeded politeness or chatty filler in UI labels and descriptions.
        {
            name: 'filler or label politeness',
            pattern: wholeWord("veuillez|n[’']hésitez|facilement|simplement"),
        },
    ],
    'es.json': [
        // Inflated marketing adjectives and filler adverbs avoided in Spanish UI copy.
        {
            name: 'inflated wording or filler',
            pattern: wholeWord(
                'fluido|fluida|sin esfuerzo|robusto|robusta|aprovechar|optimizar|potente|desbloquear|por favor|fácilmente|simplemente|en tiempo real|impactante'
            ),
        },
        // Studio Spanish uses consistent tú; guard against usted pronouns and known usted leaks.
        {
            name: 'formal usted register',
            pattern: wholeWord('usted|ustedes|reduzca|muévalos'),
        },
        // Spanish catalog standardized on curly “…” rather than «…» guillemets.
        {
            name: 'guillemets',
            pattern: /[«»]/,
        },
    ],
    'de.json': [
        // Studio German uses formal Sie everywhere; reject informal du/dein pronouns and imperatives.
        {
            name: 'informal du register',
            pattern: wholeWord(
                'du|dich|dir|dein|deine|deiner|deines|deinem|deinen|euch|euer|eure|eurem|euren|eures|speichere|lade|prüfe|entferne'
            ),
        },
        // Inflated wording and unnecessary politeness filler in German UI labels.
        {
            name: 'inflated wording or filler',
            pattern: wholeWord('nahtlos|mühelos|leistungsstark|freischalten|in Echtzeit|bitte'),
        },
    ],
}
/* cspell:enable */

describe('Studio copy typography', () => {
    for (const file of readdirSync(messagesDirectory).filter(name => name.endsWith('.json'))) {
        test(`${file} satisfies typography and anti-slop guard rules`, () => {
            const catalog = JSON.parse(
                readFileSync(join(messagesDirectory, file), 'utf8')
            ) as Record<string, unknown>
            const rules = [...universalRules, ...(localeRules[file] ?? [])]
            const offending: string[] = []

            for (const [key, rawValue] of Object.entries(catalog)) {
                if (key === '$schema') continue
                for (const text of extractMessageStrings(rawValue)) {
                    const sanitized = text.replace(/\{[^}]+\}/g, ' ')
                    for (const rule of rules) {
                        if (rule.pattern.test(sanitized)) {
                            offending.push(`${key} [${rule.name}]: ${text}`)
                        }
                    }
                }
            }

            expect(offending).toEqual([])
        })
    }
})
