import { expect, test } from 'bun:test'

import { createCoordinationRecovery } from './coordination-recovery'

async function until(condition: () => boolean) {
    const end = Date.now() + 2_000
    while (!condition()) {
        if (Date.now() > end) throw new Error('Recovery did not complete')
        await Bun.sleep(5)
    }
}

test('recovers without a signal, retries a failed pass and stops after close', async () => {
    let calls = 0
    const errors: unknown[] = []
    const recovery = createCoordinationRecovery(
        () => {
            if (++calls === 1) throw new Error('Temporary database failure')
        },
        { intervalMs: 15, onError: error => errors.push(error) }
    )
    await until(() => calls >= 2)
    await recovery.close()
    const stoppedAt = calls
    await Bun.sleep(40)
    expect(calls).toBe(stoppedAt)
    expect(errors).toHaveLength(1)
})

test('coalesces reconnects during a slow pass and drains before closing', async () => {
    let calls = 0
    let release!: () => void
    const held = new Promise<void>(resolve => {
        release = resolve
    })
    const recovery = createCoordinationRecovery(
        async () => {
            calls++
            if (calls === 1) await held
        },
        {
            intervalMs: 10,
            onError: error => {
                throw error
            },
        }
    )
    recovery.request()
    await until(() => calls === 1)
    for (let i = 0; i < 20; i++) recovery.request()
    await Bun.sleep(30)
    expect(calls).toBe(1)
    release()
    await until(() => calls === 2)
    await recovery.close()
    expect(calls).toBe(2)

    let finish!: () => void
    const running = createCoordinationRecovery(
        () =>
            new Promise<void>(resolve => {
                finish = resolve
            }),
        { intervalMs: 10, onError: () => {} }
    )
    running.request()
    await until(() => finish !== undefined)
    let closed = false
    const closing = running.close().then(() => {
        closed = true
    })
    await Bun.sleep(20)
    expect(closed).toBe(false)
    finish()
    await closing
    expect(closed).toBe(true)
})

test('closing cancels a queued recovery before it can start', async () => {
    let calls = 0
    const recovery = createCoordinationRecovery(
        () => {
            calls++
        },
        { intervalMs: 100, onError: () => {} }
    )
    recovery.request()
    await recovery.close()
    recovery.request()
    expect(calls).toBe(0)
})
