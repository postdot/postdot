import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every MDX file of the docs collection, as URL slugs relative to `/docs`.
 * Parenthesized folders only group files, and `index` names its folder:
 * `(guides)/(studio)/providers/index.mdx` serves `/docs/providers`, and
 * `(guides)/index.mdx` serves `/docs` (the empty slug).
 */
export function collectDocsSlugs(
    dir: string = path.join(appRoot, 'content', 'docs'),
    prefix: string[] = []
): string[] {
    const slugs: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            const grouped = /^\(.+\)$/.test(entry.name)
            slugs.push(
                ...collectDocsSlugs(
                    path.join(dir, entry.name),
                    grouped ? prefix : [...prefix, entry.name]
                )
            )
        } else if (entry.name.endsWith('.mdx')) {
            const name = entry.name.slice(0, -'.mdx'.length)
            slugs.push([...prefix, ...(name === 'index' ? [] : [name])].join('/'))
        }
    }
    return slugs.sort()
}

/** Where the markdown of a page is served, matching `getPageMarkdownUrl`. */
export function markdownOutputPath(slug: string) {
    const segments = slug ? slug.split('/').map(encodeURIComponent) : []
    return `/llms.mdx/docs/${[...segments, 'content.md'].join('/')}`
}
