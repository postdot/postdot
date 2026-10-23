/** Preserve provider request deadlines while honoring the enclosing effect's cancellation. */
export function effectFetcher(
    signal?: AbortSignal,
    fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
    assertActive?: () => void
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
    return (input, init) => {
        assertActive?.()
        signal?.throwIfAborted()
        const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        return fetcher(input, {
            ...init,
            signal:
                signal && requestSignal
                    ? AbortSignal.any([signal, requestSignal])
                    : (signal ?? requestSignal),
        })
    }
}
