import { readFile, writeFile, mkdir } from 'node:fs/promises'

// Keep the operational guide canonical; the public site adds only navigation metadata.
const source = await readFile(
    new URL('../../../docs/deployment/self-hosting.md', import.meta.url),
    'utf8'
)
const body = source
    .replace(/^# [^\n]+\n/, '')
    .replace(/<(https?:\/\/[^>]+)>/g, '[$1]($1)')
    .replaceAll('(provider-requirements.md)', '(/docs/providers/)')
    .replaceAll('(backup-and-restoration-boundary.md)', '(/docs/operations/)')
await mkdir(new URL('../content/docs/', import.meta.url), { recursive: true })
await writeFile(
    new URL('../content/docs/installation.mdx', import.meta.url),
    `---\ntitle: Installation\ndescription: Run Herald on your own infrastructure.\n---\n${body}`
)
