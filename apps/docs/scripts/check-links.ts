import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

interface PageLinks {
    ids: Set<string>
    links: string[]
}

async function filesBelow(directory: string): Promise<string[]> {
    const result: string[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) result.push(...(await filesBelow(path)))
        else if (entry.isFile()) result.push(path)
    }
    return result
}

async function collect(html: string): Promise<PageLinks> {
    const data: PageLinks = { ids: new Set(), links: [] }
    await new HTMLRewriter()
        .on('[id]', {
            element(element) {
                const id = element.getAttribute('id')
                if (id) data.ids.add(id)
            },
        })
        .on('a[href]', {
            element(element) {
                const href = element.getAttribute('href')
                if (href) data.links.push(href)
            },
        })
        .transform(new Response(html))
        .text()
    return data
}

/** Inspect built HTML, never a running server or external URL. */
export async function checkExportLinks(directory: string): Promise<{
    pages: number
    checked: number
    failures: string[]
}> {
    const root = resolve(directory)
    const pages = new Map<string, PageLinks>()
    for (const file of await filesBelow(root)) {
        if (file.endsWith('.html')) pages.set(file, await collect(await readFile(file, 'utf8')))
    }
    if (!pages.size) throw new Error(`No exported HTML found in ${root}`)
    const failures: string[] = []
    const seen = new Set<string>()
    let checked = 0
    for (const [file, page] of pages) {
        const path = relative(root, file)
            .replaceAll('\\', '/')
            .replace(/index\.html$/, '')
        const base = new URL(path, 'https://postbot.invalid/')
        for (const href of page.links) {
            let url: URL
            try {
                url = new URL(href, base)
            } catch {
                failures.push(`${path}: invalid link ${href}`)
                continue
            }
            if (url.origin !== base.origin) continue
            const signature = url.href
            if (seen.has(signature)) continue
            seen.add(signature)
            checked += 1
            let target: string
            let fragment: string
            try {
                target = resolve(root, `.${decodeURIComponent(url.pathname)}`)
                fragment = decodeURIComponent(url.hash.slice(1)).split(':~:text=')[0] ?? ''
            } catch {
                failures.push(`${path}: malformed encoded link ${href}`)
                continue
            }
            if (relative(root, target).startsWith('..')) {
                failures.push(`${path}: link escapes export root ${href}`)
                continue
            }
            try {
                if ((await stat(target)).isDirectory()) target = join(target, 'index.html')
                if (!(await stat(target)).isFile()) throw new Error('Not a file')
            } catch {
                failures.push(`${path}: missing target ${href}`)
                continue
            }
            if (fragment && pages.has(target) && !pages.get(target)!.ids.has(fragment)) {
                failures.push(`${path}: missing fragment ${href}`)
            }
        }
    }
    return { pages: pages.size, checked, failures }
}

if (import.meta.main) {
    const result = await checkExportLinks(process.argv[2] ?? './out')
    if (result.failures.length) {
        console.error(result.failures.join('\n'))
        process.exitCode = 1
    }
    console.log(
        `Static links: ${result.pages} pages, ${result.checked} local targets, ${result.failures.length} failures.`
    )
}
