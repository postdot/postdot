import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { llms } from 'fumadocs-core/source'

import { getPageMarkdownUrl } from './markdown'
import { source } from './source'

export async function getLLMText(page: (typeof source)['$inferPage']) {
    let body: string
    if (page.path.includes('reference/(generated)/')) {
        // Generated MDX is a renderer invocation, not the operation contract.
        const preload = page.data._openapi?.preload as string[] | undefined
        if (!preload?.length) throw new Error(`Missing operation schema: ${page.path}`)
        const schemas = await Promise.all(
            preload.map(async file => {
                if (file !== file.split('/').at(-1) || !file.endsWith('.json')) {
                    throw new Error(`Invalid operation fragment: ${file}`)
                }
                return readFile(join('.openapi/operations', file), 'utf8')
            })
        )
        body = schemas.map(schema => `\`\`\`json\n${schema.trim()}\n\`\`\``).join('\n\n')
    } else {
        body = await page.data.getText('processed')
    }
    return `# ${page.data.title}\n\n${page.data.description ?? ''}\n\nURL: ${page.url}\n\n${body}\n`
}

export const docsLlms = llms(source, { renderPage: getLLMText })

export function getLLMIndex() {
    const links = new Map(source.getPages().map(page => [page.url, getPageMarkdownUrl(page)]))
    return docsLlms.index().replace(/\]\(([^)]+)\)/g, (match, url: string) => {
        return links.has(url) ? `](${links.get(url)})` : match
    })
}
