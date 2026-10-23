import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../dist/client')
const index = await Bun.file(`${root}/llms.txt`).text()
const full = await Bun.file(`${root}/llms-full.txt`).text()
let count = 0
for await (const relative of new Bun.Glob('llms.mdx/docs/**/content.md').scan(root)) {
    const text = await Bun.file(`${root}/${relative}`).text()
    const url = /^URL: (\/docs[^\n]*)$/m.exec(text)?.[1]
    if (!url || !text.startsWith('# ') || text.length < 120 || text.includes('<Component ')) {
        throw new Error(`Missing or unrendered Markdown: ${relative}`)
    }
    if (!(await Bun.file(`${root}${url}.html`).exists())) {
        throw new Error(`Markdown has no documentation page: ${url}`)
    }
    if (!index.includes(`](/${relative})`) || !full.includes(text.trim())) {
        throw new Error(`Markdown missing from LLM indexes: ${relative}`)
    }
    if (url.includes('/reference/') && text.includes('```json')) {
        const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1]
        if (!json || !JSON.parse(json).paths) throw new Error(`Missing API contract: ${relative}`)
    }
    count++
}
let pages = 0
for await (const _file of new Bun.Glob('docs/**/*.html').scan(root)) pages++
if (await Bun.file(`${root}/docs.html`).exists()) pages++
if (count === 0 || count !== pages) throw new Error(`Markdown coverage: ${count}/${pages}`)
const lesson = await Bun.file(`${root}/llms.mdx/docs/first-publication/content.md`).text()
for (const phrase of ['Create your project', 'Review in Studio', 'Example request to your agent']) {
    if (!lesson.includes(phrase)) throw new Error(`Missing lesson content: ${phrase}`)
}
if (/<\/?Steps?\b/.test(lesson)) throw new Error('Steps must preserve readable Markdown children')
console.log(`LLM export: ${count} pages, complete indexes and readable lesson/API content.`)
