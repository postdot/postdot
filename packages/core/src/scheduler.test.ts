import { describe, expect, test } from 'bun:test'

import {
    NextEventScheduler,
    maximumTimerDelay,
    type SchedulerClock,
    type SchedulerTimers,
} from './scheduler'

class FakeClock implements SchedulerClock {
    constructor(public current: number) {}

    now(): number {
        return this.current
    }
}

class FakeTimers implements SchedulerTimers {
    #nextId = 1
    readonly active = new Map<
        number,
        { readonly callback: () => void | Promise<void>; readonly delay: number }
    >()

    set(callback: () => void | Promise<void>, delay: number): number {
        const id = this.#nextId
        this.#nextId += 1
        this.active.set(id, { callback, delay })
        return id
    }

    clear(handle: unknown): void {
        this.active.delete(handle as number)
    }

    get onlyDelay(): number | null {
        const timers = [...this.active.values()]
        return timers.length === 1 ? (timers[0]?.delay ?? null) : null
    }

    async fireOnly(): Promise<void> {
        const entries = [...this.active.entries()]
        if (entries.length !== 1) throw new Error(`Expected one timer, received ${entries.length}`)

        const [id, timer] = entries[0]!
        this.active.delete(id)
        await timer.callback()
    }
}

function createFixture(eventAt: number | null = null) {
    const clock = new FakeClock(1_800_000_000_000)
    const timers = new FakeTimers()
    const errors: unknown[] = []
    const processedAt: number[] = []
    let nextEventAt = eventAt

    const scheduler = new NextEventScheduler({
        getNextEventAt: async () => nextEventAt,
        processDueEvents: now => {
            processedAt.push(now)
            nextEventAt = null
        },
        onError: error => errors.push(error),
        clock,
        timers,
    })

    return {
        scheduler,
        clock,
        timers,
        errors,
        processedAt,
        setNextEventAt(value: number | null) {
            nextEventAt = value
        },
    }
}

describe('next-event scheduler', () => {
    test('does not start due work when stopped during the wakeup read', async () => {
        const reading = Promise.withResolvers<void>()
        const read = Promise.withResolvers<number | null>()
        const timers = new FakeTimers()
        let reads = 0
        let processed = false
        const scheduler = new NextEventScheduler({
            getNextEventAt: () => {
                if (++reads === 1) return Promise.resolve(fixtureTime(0))
                reading.resolve()
                return read.promise
            },
            processDueEvents: () => {
                processed = true
            },
            onError: error => {
                throw error
            },
            clock: new FakeClock(fixtureTime(0)),
            timers,
        })
        await scheduler.start()
        const waking = timers.fireOnly()
        await reading.promise
        const stopping = scheduler.stop()
        read.resolve(fixtureTime(0))
        await Promise.all([waking, stopping])
        expect(processed).toBe(false)
        expect(scheduler.state).toBe('stopped')
    })

    test('drains a pending plan on shutdown without arming a timer', async () => {
        const read = Promise.withResolvers<number | null>()
        const timers = new FakeTimers()
        const scheduler = new NextEventScheduler({
            getNextEventAt: () => read.promise,
            processDueEvents: () => {
                throw new Error('Stopped scheduler ran work')
            },
            onError: error => {
                throw error
            },
            timers,
        })
        const starting = scheduler.start()
        let stopped = false
        const stopping = scheduler.stop().then(() => {
            stopped = true
        })
        await Promise.resolve()
        expect(stopped).toBe(false)
        read.resolve(fixtureTime(60_000))
        await Promise.all([starting, stopping])
        expect(scheduler.state).toBe('stopped')
        expect(timers.active.size).toBe(0)
    })

    test('ignores an older plan failure after a newer plan has succeeded', async () => {
        const older = Promise.withResolvers<number | null>()
        const errors: unknown[] = []
        const timers = new FakeTimers()
        let reads = 0
        const scheduler = new NextEventScheduler({
            getNextEventAt: () =>
                ++reads === 1 ? older.promise : Promise.resolve(fixtureTime(1_000)),
            processDueEvents: () => {},
            onError: error => errors.push(error),
            clock: new FakeClock(fixtureTime(0)),
            timers,
        })
        const starting = scheduler.start()
        await scheduler.replan()
        older.reject(new Error('stale read failed'))
        await starting
        expect(scheduler.state).toBe('started')
        expect(timers.onlyDelay).toBe(1_000)
        expect(errors).toEqual([])
        await scheduler.stop()
    })

    test('keeps no timer when durable work is empty', async () => {
        const fixture = createFixture()

        await fixture.scheduler.start()

        expect(fixture.scheduler.state).toBe('started')
        expect(fixture.scheduler.scheduledAt).toBeNull()
        expect(fixture.timers.active.size).toBe(0)
    })

    test('arms only the nearest event and replaces it during replanning', async () => {
        const fixture = createFixture(fixtureTime(60_000))
        await fixture.scheduler.start()

        expect(fixture.timers.active.size).toBe(1)
        expect(fixture.timers.onlyDelay).toBe(60_000)

        fixture.setNextEventAt(fixtureTime(10_000))
        await fixture.scheduler.replan()

        expect(fixture.timers.active.size).toBe(1)
        expect(fixture.timers.onlyDelay).toBe(10_000)
        expect(fixture.scheduler.scheduledAt).toBe(fixtureTime(10_000))
    })

    test('processes an event once and replans from durable state', async () => {
        const fixture = createFixture(fixtureTime(1_000))
        await fixture.scheduler.start()
        fixture.clock.current = fixtureTime(1_000)

        await fixture.timers.fireOnly()

        expect(fixture.processedAt).toEqual([fixtureTime(1_000)])
        expect(fixture.scheduler.state).toBe('started')
        expect(fixture.timers.active.size).toBe(0)
    })

    test('waits for in-flight processing before completing shutdown', async () => {
        const clock = new FakeClock(1_800_000_000_000)
        const timers = new FakeTimers()
        const errors: unknown[] = []
        let release: (() => void) | undefined
        let processingStarted: (() => void) | undefined
        const started = new Promise<void>(resolve => {
            processingStarted = resolve
        })
        const scheduler = new NextEventScheduler({
            getNextEventAt: async () => clock.current,
            processDueEvents: async () => {
                processingStarted?.()
                await new Promise<void>(resolve => {
                    release = resolve
                })
            },
            onError: error => errors.push(error),
            clock,
            timers,
        })

        await scheduler.start()
        const wake = timers.fireOnly()
        await started

        let stopped = false
        const shutdown = scheduler.stop().then(() => {
            stopped = true
        })

        await Promise.resolve()
        expect(stopped).toBe(false)
        expect(scheduler.state).toBe('stopped')
        expect(errors).toEqual([])

        release?.()
        await Promise.all([wake, shutdown])

        expect(stopped).toBe(true)
        expect(timers.active.size).toBe(0)
    })

    test('reconstructs its timer when a new scheduler starts', async () => {
        const first = createFixture(fixtureTime(30_000))
        await first.scheduler.start()
        await first.scheduler.stop()

        const second = createFixture(fixtureTime(30_000))
        await second.scheduler.start()

        expect(first.timers.active.size).toBe(0)
        expect(second.timers.onlyDelay).toBe(30_000)
    })

    test('processes an already due event without a polling interval', async () => {
        const fixture = createFixture(fixtureTime(-1))
        await fixture.scheduler.start()

        expect(fixture.timers.onlyDelay).toBe(0)
        await fixture.timers.fireOnly()
        expect(fixture.processedAt).toEqual([fixture.clock.current])
    })

    test('caps long timers and replans without processing early', async () => {
        const eventAt = fixtureTime(maximumTimerDelay + 10_000)
        const fixture = createFixture(eventAt)
        await fixture.scheduler.start()

        expect(fixture.timers.onlyDelay).toBe(maximumTimerDelay)
        fixture.clock.current += maximumTimerDelay
        await fixture.timers.fireOnly()

        expect(fixture.processedAt).toEqual([])
        expect(fixture.scheduler.scheduledAt).toBe(eventAt)
        expect(fixture.timers.onlyDelay).toBe(10_000)
    })

    test('stops visibly when durable processing fails', async () => {
        const clock = new FakeClock(1_800_000_000_000)
        const timers = new FakeTimers()
        const errors: unknown[] = []
        const failure = new Error('database unavailable')
        const scheduler = new NextEventScheduler({
            getNextEventAt: async () => clock.current,
            processDueEvents: () => {
                throw failure
            },
            onError: error => errors.push(error),
            clock,
            timers,
        })
        await scheduler.start()

        await timers.fireOnly()

        expect(scheduler.state).toBe('failed')
        expect(timers.active.size).toBe(0)
        expect(errors).toEqual([failure])
    })
})

function fixtureTime(offset: number): number {
    return 1_800_000_000_000 + offset
}

test('recovery backs off, ignores wakeup hints and resets after durable success', async () => {
    const clock = new FakeClock(1000)
    const timers = new FakeTimers()
    const errors: unknown[] = []
    let failures = 2
    const scheduler = new NextEventScheduler({
        clock,
        timers,
        onError: error => errors.push(error),
        retryDelay: (_, count) => Math.min(30000, 1000 * 2 ** (count - 1)),
        getNextEventAt: async () => {
            if (failures-- > 0) throw new Error('conflict')
            return null
        },
        processDueEvents: () => {
            throw new Error('no work expected')
        },
    })
    await scheduler.start()
    expect(scheduler.state).toBe('recovering')
    expect(timers.onlyDelay).toBe(1000)
    await scheduler.replan()
    expect(timers.onlyDelay).toBe(1000)
    clock.current += 1000
    await timers.fireOnly()
    expect(timers.onlyDelay).toBe(2000)
    clock.current += 2000
    await timers.fireOnly()
    expect(scheduler.state).toBe('started')
    expect(timers.onlyDelay).toBeNull()
    failures = 1
    await scheduler.replan()
    expect(timers.onlyDelay).toBe(1000)
    const stale = [...timers.active.values()][0]!.callback
    await scheduler.stop()
    await stale()
    expect(scheduler.state).toBe('stopped')
    expect(timers.active.size).toBe(0)
    expect(errors).toHaveLength(3)
})

test('recovery honors capped timers and keeps unclassified errors terminal', async () => {
    const clock = new FakeClock(1000)
    const timers = new FakeTimers()
    const conflict = new Error('conflict')
    const permanent = new Error('permanent')
    let error = conflict
    const errors: unknown[] = []
    const scheduler = new NextEventScheduler({
        clock,
        timers,
        maximumDelay: 100,
        getNextEventAt: async () => {
            throw error
        },
        processDueEvents: () => {},
        retryDelay: failure => (failure === conflict ? 1000 : null),
        onError: failure => errors.push(failure),
    })
    await scheduler.start()
    clock.current += 100
    await timers.fireOnly()
    expect(errors).toEqual([conflict])
    expect(timers.onlyDelay).toBe(100)
    clock.current += 900
    error = permanent
    await timers.fireOnly()
    expect(scheduler.state).toBe('failed')
    expect(timers.active.size).toBe(0)
    expect(errors).toEqual([conflict, permanent])
    await scheduler.stop()
})
