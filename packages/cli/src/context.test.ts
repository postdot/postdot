import { expect, test } from 'bun:test'

import { result } from './context'

test('server conflicts retain their actionable message, code and confirmation data', async () => {
    const error = {
        code: 'cadence_conflict',
        message: 'Review the channel cadence before confirming.',
        confirmation: 'a'.repeat(64),
        warnings: [
            { channelId: 'channel', rule: 'daily_max', period: '2026-10-30', maximum: 1, count: 2 },
        ],
    }
    await expect(
        result(
            Promise.resolve({
                data: null,
                error: { value: { error } },
                status: 409,
                response: new Response(null, { status: 409 }),
            })
        )
    ).rejects.toMatchObject({
        code: error.code,
        message: error.message,
        details: { status: 409, server: error },
    })
})

test('only explicitly nullable endpoints accept an empty successful response', async () => {
    const response = { data: null, error: null, status: 200, response: new Response(null) }
    expect(await result(Promise.resolve(response), true)).toBeNull()
    await expect(result(Promise.resolve(response))).rejects.toMatchObject({
        code: 'invalid_response',
    })
})

test('identity files refuse missing, empty and oversized input before a write', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readIdentityImageFile, resolveWebsiteOption } = await import('./context')
    const dir = await mkdtemp(join(tmpdir(), 'postdot-identity-input-'))
    try {
        expect(resolveWebsiteOption({ clear: true })).toBeNull()
        expect(() => resolveWebsiteOption({ clear: true, url: 'https://example.com' })).toThrow()
        expect(() => resolveWebsiteOption({})).toThrow()
        await expect(readIdentityImageFile(join(dir, 'missing'))).rejects.toMatchObject({
            code: 'invalid_input',
        })
        await writeFile(join(dir, 'empty'), '')
        await expect(readIdentityImageFile(join(dir, 'empty'))).rejects.toMatchObject({
            code: 'invalid_input',
        })
        await writeFile(join(dir, 'large'), new Uint8Array(2 * 1024 * 1024 + 1))
        await expect(readIdentityImageFile(join(dir, 'large'))).rejects.toMatchObject({
            code: 'invalid_input',
        })
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
