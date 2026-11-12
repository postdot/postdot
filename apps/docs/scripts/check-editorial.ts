/** Checks the rendered editorial surfaces and their machine-readable exports together. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { appRoot, collectEditorialPages } from './docs-paths'

const root = join(appRoot, 'dist/client')
const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8')
const index = await readFile(join(root, 'llms.txt'), 'utf8')
const full = await readFile(join(root, 'llms-full.txt'), 'utf8')
const feed = await readFile(join(root, 'blog/rss.xml'), 'utf8')
let count = 0
for (const page of collectEditorialPages()) {
    const html = await readFile(join(root, `${page.url}.html`), 'utf8')
    const markdown = await readFile(join(root, `${page.url}.md`), 'utf8')
    const metadata = new Map<string, string>()
    let canonical = ''
    let headings = 0
    const json: string[] = []
    await new HTMLRewriter()
        .on('h1', {
            element() {
                headings++
            },
        })
        .on('meta', {
            element(element) {
                const key = element.getAttribute('property') ?? element.getAttribute('name')
                if (key) metadata.set(key, element.getAttribute('content') ?? '')
            },
        })
        .on('link[rel="canonical"]', {
            element(element) {
                canonical = element.getAttribute('href') ?? ''
            },
        })
        .on('script[type="application/ld+json"]', {
            element() {
                json.push('')
            },
            text(chunk) {
                json[json.length - 1] += chunk.text
            },
        })
        .transform(new Response(html))
        .text()
    if (headings !== 1 || !metadata.get('description') || !canonical.endsWith(page.url)) {
        throw new Error(`Missing editorial heading or metadata: ${page.url}`)
    }
    if (!sitemap.includes(`<loc>${canonical}</loc>`))
        throw new Error(`Missing sitemap URL: ${page.url}`)
    if (
        !markdown.startsWith('# ') ||
        !markdown.includes(`URL: ${page.url}`) ||
        !index.includes(`](${page.url}.md)`) ||
        !full.includes(markdown.trim())
    ) {
        throw new Error(`Incomplete editorial Markdown exports: ${page.url}`)
    }
    const entities = json.flatMap(text => {
        const data = JSON.parse(text) as { '@graph'?: Array<Record<string, unknown>> }
        return data['@graph'] ?? []
    })
    if (!entities.some(entity => entity['@type'] === 'BreadcrumbList'))
        throw new Error(`Missing breadcrumbs: ${page.url}`)
    if (page.section === 'blog') {
        if (
            metadata.get('og:type') !== 'article' ||
            !entities.some(
                entity =>
                    entity['@type'] === 'BlogPosting' &&
                    entity.datePublished &&
                    entity.author &&
                    entity.url === canonical
            ) ||
            !feed.includes(`<link>${canonical}</link>`)
        ) {
            throw new Error(`Incomplete article metadata or RSS: ${page.url}`)
        }
    }
    count++
}
for (const section of ['blog', 'compare', 'features']) {
    const html = await readFile(join(root, `${section}.html`), 'utf8')
    if (!html.includes(`/${section}/`)) throw new Error(`Empty editorial index: ${section}`)
}
console.log(
    `Editorial export: ${count} pages, canonical URLs, sitemap, structured data, Markdown, LLM indexes and RSS.`
)
