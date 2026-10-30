import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJsonObject } from './input'

test('file input rejects oversized, malformed, non-object and invalid UTF-8 data before sending it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'postdot-cli-input-'))
    const file = join(directory, 'input.json')
    try {
        for (const invalid of [
            '{broken',
            '[]',
            'null',
            '"text"',
            ' '.repeat(1_048_577),
            Buffer.from([0xff]),
        ]) {
            await writeFile(file, invalid)
            await expect(readJsonObject(file)).rejects.toMatchObject({
                code: 'invalid_input',
                exitCode: 2,
            })
        }
        const body = { expectedRevision: 3, targetContent: { body: '2026-10-30', media: [] } }
        await writeFile(file, JSON.stringify(body))
        expect(await readJsonObject(file)).toEqual(body)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
