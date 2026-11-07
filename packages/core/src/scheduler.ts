import { DomainInvariantError, requireTimestamp } from './invariants'

export const maximumTimerDelay = 2_147_483_647

export interface SchedulerClock {
    now(): number
}

export interface SchedulerTimers {
    set(callback: () => void | Promise<void>, delay: number): unknown
    clear(handle: unknown): void
}

export type SchedulerState = 'idle' | 'started' | 'running' | 'stopped' | 'failed'

export interface NextEventSchedulerOptions {
    readonly getNextEventAt: () => Promise<number | null>
    readonly processDueEvents: (now: number) => void | Promise<void>
    readonly onError: (error: unknown) => void
    readonly clock?: SchedulerClock
    readonly timers?: SchedulerTimers
    readonly maximumDelay?: number
}

const systemClock: SchedulerClock = {
    now: Date.now,
}

const systemTimers: SchedulerTimers = {
    set(callback, delay) {
        return setTimeout(() => void callback(), delay)
    },
    clear(handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
}

export class NextEventScheduler {
    readonly #getNextEventAt: () => Promise<number | null>
    #planSequence = 0
    readonly #processDueEvents: (now: number) => void | Promise<void>
    readonly #onError: (error: unknown) => void
    readonly #clock: SchedulerClock
    readonly #timers: SchedulerTimers
    readonly #maximumDelay: number

    #state: SchedulerState = 'idle'
    #timer: unknown | null = null
    #activeRun: Promise<void> | null = null
    readonly #activePlans = new Set<Promise<void>>()
    #stopping = false
    #generation = 0
    #scheduledAt: number | null = null

    constructor(options: NextEventSchedulerOptions) {
        this.#getNextEventAt = options.getNextEventAt
        this.#processDueEvents = options.processDueEvents
        this.#onError = options.onError
        this.#clock = options.clock ?? systemClock
        this.#timers = options.timers ?? systemTimers
        this.#maximumDelay = options.maximumDelay ?? maximumTimerDelay

        if (!Number.isSafeInteger(this.#maximumDelay) || this.#maximumDelay <= 0) {
            throw new DomainInvariantError(
                'invalid_time',
                'maximumDelay must be a positive safe integer'
            )
        }
    }

    get state(): SchedulerState {
        return this.#state
    }

    get scheduledAt(): number | null {
        return this.#scheduledAt
    }

    /** Starts the scheduler; the returned promise settles once the first plan is armed. */
    start(): Promise<void> {
        if (this.#state !== 'idle') {
            throw new DomainInvariantError(
                'invalid_transition',
                'The scheduler can start only once'
            )
        }

        this.#state = 'started'
        return this.#trackPlan()
    }

    /** Re-reads the next event; the returned promise settles once the plan is armed. */
    replan(): Promise<void> {
        if (this.#state === 'running') return Promise.resolve()
        if (this.#state !== 'started') {
            throw new DomainInvariantError(
                'invalid_transition',
                'Only a started scheduler can be replanned'
            )
        }

        return this.#trackPlan()
    }

    stop(): Promise<void> {
        this.#stopping = true
        this.#clearTimer()
        this.#state = 'stopped'
        return Promise.all([...this.#activePlans, this.#activeRun]).then(() => {})
    }

    #trackPlan(): Promise<void> {
        const plan = this.#plan()
        this.#activePlans.add(plan)
        void plan.then(
            () => this.#activePlans.delete(plan),
            () => this.#activePlans.delete(plan)
        )
        return plan
    }

    async #plan(): Promise<void> {
        this.#clearTimer()
        // Reading the next event is asynchronous: only the latest plan of a
        // still-started scheduler may arm a timer.
        const sequence = ++this.#planSequence

        try {
            const eventAt = await this.#getNextEventAt()
            if (sequence !== this.#planSequence || this.#state !== 'started') return
            this.#clearTimer()
            if (eventAt === null) return

            this.#scheduledAt = requireTimestamp(eventAt, 'nextEventAt')
            const now = requireTimestamp(this.#clock.now(), 'now')
            const delay = Math.min(Math.max(0, this.#scheduledAt - now), this.#maximumDelay)
            const generation = this.#generation
            this.#timer = this.#timers.set(() => this.#wake(generation), delay)
        } catch (error) {
            if (sequence !== this.#planSequence || this.#state !== 'started') return
            this.#fail(error)
        }
    }

    async #wake(generation: number): Promise<void> {
        if (generation !== this.#generation || this.#state !== 'started') return

        const activeRun = this.#run()
        this.#activeRun = activeRun
        try {
            await activeRun
        } finally {
            if (this.#activeRun === activeRun) this.#activeRun = null
        }
    }

    async #run(): Promise<void> {
        this.#timer = null
        this.#scheduledAt = null
        this.#state = 'running'

        try {
            const now = requireTimestamp(this.#clock.now(), 'now')
            const eventAt = await this.#getNextEventAt()
            if (this.#state !== 'running') return

            if (eventAt !== null && requireTimestamp(eventAt, 'nextEventAt') <= now) {
                await this.#processDueEvents(now)
            }

            if (this.#state !== 'running') return
            this.#state = 'started'
            await this.#plan()
        } catch (error) {
            if (this.#stopping) {
                this.#onError(error)
                return
            }
            this.#fail(error)
        }
    }

    #clearTimer(): void {
        this.#generation += 1
        this.#scheduledAt = null

        if (this.#timer === null) return
        this.#timers.clear(this.#timer)
        this.#timer = null
    }

    #fail(error: unknown): void {
        this.#clearTimer()
        this.#state = 'failed'
        this.#onError(error)
    }
}
