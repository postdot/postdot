/** Bounded, non-overlapping recovery independent of successful NOTIFY delivery. */
export function createCoordinationRecovery(
    resync: () => void | Promise<void>,
    options: { intervalMs: number; onError: (error: unknown) => void }
) {
    if (
        !Number.isSafeInteger(options.intervalMs) ||
        options.intervalMs <= 0 ||
        options.intervalMs > 2_147_483_647
    )
        throw new Error('Recovery interval must be a positive integer')
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: Promise<void> | undefined
    let requested = false

    const schedule = () => {
        if (!closed) timer = setTimeout(request, options.intervalMs)
    }
    function request() {
        if (closed) return
        if (active !== undefined) {
            requested = true
            return
        }
        clearTimeout(timer)
        active = Promise.resolve()
            .then(async () => {
                if (closed) return
                do {
                    requested = false
                    try {
                        await resync()
                    } catch (error) {
                        options.onError(error)
                    }
                } while (requested && !closed)
            })
            .finally(() => {
                active = undefined
                schedule()
            })
    }
    schedule()
    return {
        request,
        async close() {
            closed = true
            clearTimeout(timer)
            await active
        },
    }
}
