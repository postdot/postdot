import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addProfile, saveCredential } from './configuration'
import { createProgram } from './program'

test('posts compose sends the atomic request and retains machine-readable conflicts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'postdot-composition-cli-'))
    const profile = { name: 'composition', origin: 'https://postdot.example', project: 'project' }
    addProfile({ configDir: directory }, profile)
    saveCredential({ configDir: directory }, profile, 'postdot_pat_composition')
    const input = {
        expectedSourceRevision: 2,
        sourceContent: { body: { format: 'plain_text', text: 'Changed' }, media: [] },
        publications: [{ publicationId: 'publication', expectedRevision: 3 }],
    }
    const file = join(directory, 'composition.json')
    writeFileSync(file, JSON.stringify(input))
    const conflict = {
        code: 'write_conflict',
        message: 'Changed elsewhere',
        conflictingPublicationIds: ['publication'],
    }
    const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (request: string | URL | Request, init?: RequestInit) => {
                expect(String(request)).toBe(
                    `${profile.origin}/api/projects/project/posts/post/composition`
                )
                expect(init?.method).toBe('PUT')
                expect(new Headers(init?.headers).get('authorization')).toBe(
                    'Bearer postdot_pat_composition'
                )
                expect(JSON.parse(String(init?.body))).toEqual(input)
                return Response.json({ error: conflict }, { status: 409 })
            },
            { preconnect: fetch.preconnect }
        )
    )
    try {
        await expect(
            createProgram({ jsonErrors: true }).parseAsync(
                [
                    '--config-dir',
                    directory,
                    '--profile',
                    profile.name,
                    'posts',
                    'compose',
                    '--post',
                    'post',
                    '--input',
                    file,
                    '--json',
                ],
                { from: 'user' }
            )
        ).rejects.toMatchObject({
            code: 'write_conflict',
            details: { status: 409, server: conflict },
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
        fetcher.mockRestore()
        rmSync(directory, { recursive: true, force: true })
    }
})
