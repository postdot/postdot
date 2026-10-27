import { expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkExportLinks } from './check-links'

it('checks encoded fragments, relative pages and downloads without fetching external links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-doc-links-'))
    try {
        await mkdir(join(directory, 'guide'))
        await writeFile(
            join(directory, 'index.html'),
            '<a href="/guide/#a%20b">Guide</a><a href="/schema.json">Schema</a><a href="https://example.invalid/not-fetched">External</a>'
        )
        await writeFile(
            join(directory, 'guide/index.html'),
            '<h2 id="a b">A</h2><a href="../">Home</a>'
        )
        await writeFile(join(directory, 'schema.json'), '{}')
        expect((await checkExportLinks(directory)).failures).toEqual([])
        await writeFile(
            join(directory, 'guide/index.html'),
            '<a href="/#missing">Bad anchor</a><a href="/missing/">Bad page</a>'
        )
        const result = await checkExportLinks(directory)
        expect(result.failures.some(message => message.includes('missing fragment'))).toBe(true)
        expect(result.failures.some(message => message.includes('missing target'))).toBe(true)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
