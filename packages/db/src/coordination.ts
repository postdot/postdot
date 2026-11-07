import { SQL } from 'bun'

/**
 * Coordination between Postdot server instances (ADR-097 §7).
 *
 * A signal only wakes; it never carries facts. Each instance rereads the
 * durable state (event journal, schedules, settings) after a signal, so a lost
 * signal delays work but never corrupts it, and `resync` covers the gaps of a
 * reconnect. Leadership elects the one instance that runs the background
 * runtimes; every instance serves HTTP.
 */
export type CoordinationSignal =
    /** Projects whose durable journal advanced. */
    | { readonly kind: 'projects'; readonly projectIds: readonly string[] }
    /** Scheduled publication work changed. */
    | { readonly kind: 'work' }
    /** Media may need background processing (video previews). */
    | { readonly kind: 'media' }
    /** The installation email settings changed. */
    | { readonly kind: 'email-settings' }
    /** A collaborative draft changed (ephemeral; viewers reread it). */
    | { readonly kind: 'draft'; readonly change: Readonly<Record<string, unknown>> }

export interface CoordinationHandlers {
    signal(signal: CoordinationSignal): void
    /** Signals may have been missed (a reconnect): reread every durable source. */
    resync(): void
}

export interface LeadershipHandlers {
    /** This instance became the leader. */
    acquired(): void
    /** Leadership ended without being released (lost connection). */
    lost(): void
}

export interface InstanceCoordination {
    /** `single`: this process is the only server by construction. */
    readonly mode: 'single' | 'multiple'
    /** Delivers a signal to every instance, this one included. */
    publish(signal: CoordinationSignal): void
    subscribe(handlers: CoordinationHandlers): Promise<void>
    /** Starts competing for leadership; `single` leads at once. */
    lead(handlers: LeadershipHandlers): void
    isLeader(): boolean
    close(): Promise<void>
}

/** One server process: signals are delivered in-process and it always leads. */
export function createLocalCoordination(): InstanceCoordination {
    const subscribers: CoordinationHandlers[] = []
    let leader = false
    return {
        mode: 'single',
        publish(signal) {
            for (const subscriber of subscribers) subscriber.signal(signal)
        },
        async subscribe(handlers) {
            subscribers.push(handlers)
        },
        lead(handlers) {
            leader = true
            handlers.acquired()
        },
        isLeader: () => leader,
        async close() {
            subscribers.length = 0
            leader = false
        },
    }
}

const signalChannel = 'postdot_signals'
/** PostgreSQL rejects NOTIFY payloads of 8000 bytes or more. */
const maximumPayloadBytes = 7_500
/** Two-key advisory lock (namespace, key) identifying the runtime leader. */
export const postgresLeaderLock = [731_020_162, 1] as const

export interface PostgresCoordinationOptions {
    /** Delay between leadership attempts while another instance leads. */
    readonly retryMs?: number
    /** Delay between checks that the leader still holds its lock. */
    readonly heartbeatMs?: number
    readonly onError?: (error: unknown) => void
}

/**
 * Several server processes share one PostgreSQL database: signals travel by
 * `LISTEN/NOTIFY`, and leadership is a session advisory lock held on a
 * reserved connection. A lock lost with its connection is reported, so the
 * former leader stops instead of running beside the new one.
 */
export function createPostgresCoordination(
    url: string,
    options: PostgresCoordinationOptions = {}
): InstanceCoordination {
    const retryMs = options.retryMs ?? 2_000
    const heartbeatMs = options.heartbeatMs ?? 5_000
    const report = options.onError ?? (error => console.error('[postdot-coordination]', error))
    const client = new SQL(url, { max: 2 })
    let leader = false
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let session: Awaited<ReturnType<SQL['reserve']>> | undefined
    let subscription: { unlisten(): Promise<void> } | undefined

    function payloads(signal: CoordinationSignal): string[] {
        if (signal.kind !== 'projects') return [JSON.stringify(signal)]
        const result: string[] = []
        let batch: string[] = []
        const flush = () => {
            if (batch.length > 0)
                result.push(JSON.stringify({ kind: 'projects', projectIds: batch }))
            batch = []
        }
        for (const projectId of signal.projectIds) {
            batch.push(projectId)
            if (
                JSON.stringify({ kind: 'projects', projectIds: batch }).length > maximumPayloadBytes
            ) {
                batch.pop()
                flush()
                batch.push(projectId)
            }
        }
        flush()
        return result
    }

    async function attempt(handlers: LeadershipHandlers): Promise<void> {
        if (closed) return
        try {
            session ??= await client.reserve()
            const [row] = (await session.unsafe('select pg_try_advisory_lock($1, $2) as held', [
                ...postgresLeaderLock,
            ])) as { held: boolean }[]
            if (row?.held === true) {
                leader = true
                handlers.acquired()
                timer = setTimeout(() => void heartbeat(handlers), heartbeatMs)
                return
            }
        } catch (error) {
            report(error)
            await session?.release()
            session = undefined
        }
        if (!closed) timer = setTimeout(() => void attempt(handlers), retryMs)
    }

    async function heartbeat(handlers: LeadershipHandlers): Promise<void> {
        if (closed) return
        let held = false
        try {
            const [row] = (await session!.unsafe(
                `select exists (
                    select 1 from pg_locks
                    where locktype = 'advisory' and granted and pid = pg_backend_pid()
                      and classid = $1 and objid = $2 and objsubid = 2
                ) as held`,
                [...postgresLeaderLock]
            )) as { held: boolean }[]
            held = row?.held === true
        } catch (error) {
            report(error)
        }
        if (closed) return
        if (!held) {
            leader = false
            handlers.lost()
            return
        }
        timer = setTimeout(() => void heartbeat(handlers), heartbeatMs)
    }

    return {
        mode: 'multiple',
        publish(signal) {
            for (const payload of payloads(signal)) {
                client.unsafe('select pg_notify($1, $2)', [signalChannel, payload]).catch(report)
            }
        },
        async subscribe(handlers) {
            let first = true
            subscription = await client.listen(
                signalChannel,
                payload => {
                    try {
                        handlers.signal(JSON.parse(payload) as CoordinationSignal)
                    } catch (error) {
                        report(error)
                    }
                },
                () => {
                    // A reconnect may have dropped signals: reread durable state.
                    if (!first) handlers.resync()
                    first = false
                }
            )
        },
        lead(handlers) {
            void attempt(handlers)
        },
        isLeader: () => leader,
        async close() {
            closed = true
            leader = false
            if (timer !== undefined) clearTimeout(timer)
            await subscription?.unlisten().catch(report)
            if (session !== undefined) {
                await session.unsafe('select pg_advisory_unlock_all()').catch(report)
                await session.release()
            }
            await client.close()
        },
    }
}
