/**
 * Access to the serving runtime handle.
 *
 * Bun exposes a per-request timeout override on the server handle, and Elysia
 * only publishes that handle on the instance that called `listen()`. The
 * event-stream routes live in a nested instance mounted with `use()`, where
 * `app.server` is always undefined, so the handle cannot be reached from the
 * route module by reading the instance.
 *
 * This module bridges request-specific runtime capabilities: SSE timeout control
 * and the socket peer used by the authentication IP boundary. Neither capability
 * may be inferred from caller-controlled HTTP headers.
 */

export interface ServingHandle {
    timeout(request: Request, seconds: number): void
    requestIP?(request: Request): { readonly address: string } | null
}

let servingHandle: ServingHandle | undefined
const inheritedPeers = new WeakMap<Request, string | null>()

/** Publishes the handle of the running server. Called once, after `listen`. */
export function registerServingHandle(handle: ServingHandle | undefined): void {
    servingHandle = handle
}

export function requestPeerAddress(request: Request): string | null {
    return servingHandle?.requestIP?.(request)?.address ?? inheritedPeers.get(request) ?? null
}

/** Carry socket metadata only across an internal dispatch, never across HTTP headers. */
export function inheritRequestPeerAddress(source: Request, target: Request): Request {
    inheritedPeers.set(target, requestPeerAddress(source))
    return target
}

/**
 * Keeps one already-authorized streaming response alive for as long as the
 * client reads it.
 *
 * `0` disables the idle ceiling for that request only. Every other route keeps
 * the server default. The call is a no-op when no server is publishing a handle,
 * which is the case for in-process tests that never call `listen`.
 */
export function keepResponseAliveBeyondIdleTimeout(request: Request): void {
    servingHandle?.timeout(request, 0)
}
