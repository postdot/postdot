import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../dist/client')
const pages = ['index.html', 'docs.html']
for await (const page of new Bun.Glob('docs/**/*.html').scan(root)) pages.push(page)
const images = new Set<string>()
for (const page of pages) {
    const values = new Map<string, string>()
    const rewriter = new HTMLRewriter().on('meta', {
        element(element) {
            const key = element.getAttribute('property') ?? element.getAttribute('name')
            const value = element.getAttribute('content')
            if (key && value) values.set(key, value)
        },
    })
    await rewriter.transform(new Response(Bun.file(`${root}/${page}`))).text()
    const image = values.get('og:image')
    if (!image || image !== values.get('twitter:image'))
        throw new Error(`Missing social image: ${page}`)
    const pathname = new URL(image).pathname
    if (!pathname.startsWith('/og/') || !values.get('og:image:alt'))
        throw new Error(`Invalid OG metadata: ${page}`)
    if (values.get('twitter:card') !== 'summary_large_image')
        throw new Error(`Missing large card: ${page}`)
    if (values.get('og:image:width') !== '1200' || values.get('og:image:height') !== '630') {
        throw new Error(`Invalid declared dimensions: ${page}`)
    }
    if (images.has(pathname))
        throw new Error(`Shared fallback instead of page-specific image: ${page}`)
    images.add(pathname)
    const png = Buffer.from(await Bun.file(`${root}${pathname}`).arrayBuffer())
    if (
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        png.readUInt32BE(16) !== 1200 ||
        png.readUInt32BE(20) !== 630
    ) {
        throw new Error(`Invalid PNG: ${pathname}`)
    }
}
console.log(
    `OG export: ${pages.length} pages, distinct 1200×630 PNGs and matching social metadata.`
)
