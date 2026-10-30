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
