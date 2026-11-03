import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const WEB_ROOT = join(import.meta.dir, '../apps/web')
const PARAGLIDE_DIR = join(WEB_ROOT, 'src/paraglide')
const MESSAGES_DIR = join(PARAGLIDE_DIR, 'messages')
const LOCALES_DIR = join(WEB_ROOT, 'src/locales')

const NON_BASE_LOCALES = ['fr', 'es', 'de'] as const

export async function splitLocales(): Promise<void> {
    try {
        await mkdir(LOCALES_DIR, { recursive: true })

        const entries = await readdir(MESSAGES_DIR)
        const jsFiles = entries.filter(e => e.endsWith('.js') && !e.startsWith('_index'))

        if (jsFiles.length === 0) {
            return
        }

        const localeCatalogEntries: Record<(typeof NON_BASE_LOCALES)[number], string[]> = {
            fr: [],
            es: [],
            de: [],
        }

        const needsRegistryForLocale: Record<(typeof NON_BASE_LOCALES)[number], boolean> = {
            fr: false,
            es: false,
            de: false,
        }

        for (const filename of jsFiles) {
            const id = filename.replace(/\.js$/, '')
            const filePath = join(MESSAGES_DIR, filename)
            const content = await readFile(filePath, 'utf8')

            // 1. Locate en
            const enPrefix = `const en_${id} = `
            const enStart = content.indexOf(enPrefix)
            if (enStart === -1) continue

            // Header before en
            const header = content.slice(0, enStart).trimEnd()

            // 2. Locate fr
            const frPrefix = `\nconst fr_${id} = `
            const frStart = content.indexOf(frPrefix, enStart)
            if (frStart === -1) continue

            const enCode = content
                .slice(enStart + enPrefix.length, frStart)
                .trim()
                .replace(/;+$/, '')

            // 3. Locate es
            const esPrefix = `\nconst es_${id} = `
            const esStart = content.indexOf(esPrefix, frStart)
            if (esStart === -1) continue

            const frCode = content
                .slice(frStart + frPrefix.length, esStart)
                .trim()
                .replace(/;+$/, '')

            // 4. Locate de
            const dePrefix = `\nconst de_${id} = `
            const deStart = content.indexOf(dePrefix, esStart)
            if (deStart === -1) continue

            const esCode = content
                .slice(esStart + esPrefix.length, deStart)
                .trim()
                .replace(/;+$/, '')

            // 5. Locate export section (after de)
            const exportIdx = content.indexOf(`export const ${id} = `, deStart)
            if (exportIdx === -1) continue

            // Find the comment right before export const {id}
            const commentStart = content.lastIndexOf('/**', exportIdx)
            const deEnd = commentStart !== -1 ? commentStart : exportIdx
            const deCode = content
                .slice(deStart + dePrefix.length, deEnd)
                .trim()
                .replace(/;+$/, '')

            // Save translations
            const locCodes = { fr: frCode, es: esCode, de: deCode }
            for (const loc of NON_BASE_LOCALES) {
                const code = locCodes[loc]
                if (code.includes('registry.')) {
                    needsRegistryForLocale[loc] = true
                }
                localeCatalogEntries[loc].push(`    ${JSON.stringify(id)}: ${code},`)
            }

            // Extract export section: from commentStart (or exportIdx) to end
            const exportSection = content.slice(commentStart !== -1 ? commentStart : exportIdx)

            // Replace the body of export const {id}
            const oldBodyPattern = new RegExp(
                `\\tif \\(locale === "fr"\\) return fr_${id}\\(inputs\\)\\n` +
                    `\\tif \\(locale === "es"\\) return es_${id}\\(inputs\\)\\n` +
                    `\\tif \\(locale === "de"\\) return de_${id}\\(inputs\\)\\n` +
                    `\\treturn en_${id}\\(inputs\\)`
            )

            const newBody =
                `\tif (locale !== "en") {\n` +
                `\t\tconst __fn = getLocaleTranslation(locale, ${JSON.stringify(id)})\n` +
                `\t\tif (__fn) return __fn(inputs)\n` +
                `\t}\n` +
                `\treturn en_${id}(inputs)`

            let rewrittenExport = exportSection.replace(oldBodyPattern, newBody)

            if (rewrittenExport === exportSection) {
                rewrittenExport = exportSection.replace(
                    new RegExp(`if \\(locale === "fr"\\)[\\s\\S]*?return en_${id}\\((.*?)\\)`),
                    `if (locale !== "en") {\n\t\tconst __fn = getLocaleTranslation(locale, ${JSON.stringify(id)})\n\t\tif (__fn) return __fn($1)\n\t}\n\treturn en_${id}($1)`
                )
            }

            const importLoader = "import { getLocaleTranslation } from '@/lib/i18n-store.js';\n"
            const finalHeader = header.includes("from '../runtime.js';")
                ? header.replace("from '../runtime.js';", "from '../runtime.js';\n" + importLoader)
                : header + '\n' + importLoader

            const rewritten = `${finalHeader}\n\nconst en_${id} = ${enCode};\n\n${rewrittenExport}`
            await writeFile(filePath, rewritten, 'utf8')
        }

        // Write catalog files for non-base locales
        for (const loc of NON_BASE_LOCALES) {
            const catContent = `/* eslint-disable */\n${needsRegistryForLocale[loc] ? "import * as registry from '../paraglide/registry.js';\n" : ''}/** @typedef {import('../paraglide/runtime.js').LocalizedString} LocalizedString */\n\nexport default {\n${localeCatalogEntries[loc].join('\n')}\n};\n`
            await writeFile(join(LOCALES_DIR, `${loc}.js`), catContent, 'utf8')
        }

        console.log(
            `[i18n] Successfully decoupled ${jsFiles.length} messages into separate locale chunks`
        )
    } catch (error) {
        console.warn('[i18n] Error during splitLocales:', error)
    }
}

if (import.meta.main) {
    await splitLocales()
}
