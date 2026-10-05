/**
 * Access to the serving runtime handle.
 *
 * Bun exposes a per-request timeout override on the server handle, and Elysia
 * only publishes that handle on the instance that called `listen()`. The
 * event-stream routes live in a nested instance mounted with `use()`, where
 * `app.server` is always undefined, so the handle cannot be reached from the
 * route module by reading the instance.
 *
 * This module is the single explicit bridge for that one capability. It exists
 * because the runtime ends a connection that stays idle, and a long-lived
 * streaming response is idle between writes. Nothing else may use it: relaxing
 * a timeout is a decision about one response, not a server-wide default.
 */

export interface ServingHandle {
    timeout(request: Request, seconds: number): void
}

let servingHandle: ServingHandle | undefined

/** Publishes the handle of the running server. Called once, after `listen`. */
export function registerServingHandle(handle: ServingHandle | undefined): void {
    servingHandle = handle
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
