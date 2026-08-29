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
        getNextEventAt: () => nextEventAt,
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
    test('keeps no timer when durable work is empty', () => {
        const fixture = createFixture()

        fixture.scheduler.start()

        expect(fixture.scheduler.state).toBe('started')
        expect(fixture.scheduler.scheduledAt).toBeNull()
        expect(fixture.timers.active.size).toBe(0)
    })

    test('arms only the nearest event and replaces it during replanning', () => {
        const fixture = createFixture(fixtureTime(60_000))
        fixture.scheduler.start()

        expect(fixture.timers.active.size).toBe(1)
        expect(fixture.timers.onlyDelay).toBe(60_000)

        fixture.setNextEventAt(fixtureTime(10_000))
        fixture.scheduler.replan()

        expect(fixture.timers.active.size).toBe(1)
        expect(fixture.timers.onlyDelay).toBe(10_000)
        expect(fixture.scheduler.scheduledAt).toBe(fixtureTime(10_000))
    })

    test('processes an event once and replans from durable state', async () => {
        const fixture = createFixture(fixtureTime(1_000))
        fixture.scheduler.start()
        fixture.clock.current = fixtureTime(1_000)

        await fixture.timers.fireOnly()

        expect(fixture.processedAt).toEqual([fixtureTime(1_000)])
        expect(fixture.scheduler.state).toBe('started')
        expect(fixture.timers.active.size).toBe(0)
    })

    test('reconstructs its timer when a new scheduler starts', () => {
        const first = createFixture(fixtureTime(30_000))
        first.scheduler.start()
        first.scheduler.stop()

        const second = createFixture(fixtureTime(30_000))
        second.scheduler.start()

        expect(first.timers.active.size).toBe(0)
        expect(second.timers.onlyDelay).toBe(30_000)
    })

    test('processes an already due event without a polling interval', async () => {
        const fixture = createFixture(fixtureTime(-1))
        fixture.scheduler.start()

        expect(fixture.timers.onlyDelay).toBe(0)
        await fixture.timers.fireOnly()
        expect(fixture.processedAt).toEqual([fixture.clock.current])
    })

    test('caps long timers and replans without processing early', async () => {
        const eventAt = fixtureTime(maximumTimerDelay + 10_000)
        const fixture = createFixture(eventAt)
        fixture.scheduler.start()

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
            getNextEventAt: () => clock.current,
            processDueEvents: () => {
                throw failure
            },
            onError: error => errors.push(error),
            clock,
            timers,
        })
        scheduler.start()

        await timers.fireOnly()

        expect(scheduler.state).toBe('failed')
        expect(timers.active.size).toBe(0)
        expect(errors).toEqual([failure])
    })
})

function fixtureTime(offset: number): number {
    return 1_800_000_000_000 + offset
}
