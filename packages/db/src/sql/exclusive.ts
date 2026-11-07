import { createHash } from 'node:crypto'

/**
 * In-process exclusion by key: callers with the same key run one after the
 * other, in arrival order; different keys never wait for each other.
 */
export class KeyedQueue {
    readonly #tails = new Map<string, Promise<void>>()

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.#tails.get(key) ?? Promise.resolve()
        let release!: () => void
        const turn = new Promise<void>(resolve => {
            release = resolve
        })
        const tail = previous.then(() => turn)
        this.#tails.set(key, tail)
        try {
            await previous
            return await operation()
        } finally {
            release()
            void tail.then(() => {
                if (this.#tails.get(key) === tail) this.#tails.delete(key)
            })
        }
    }
}

/** Namespace of Postdot's keyed advisory locks (two-key form: namespace, key hash). */
export const exclusiveLockNamespace = 731_020_161

/** A stable signed 32-bit hash of a lock key. */
export function exclusiveLockKey(key: string): number {
    return createHash('sha256').update(key).digest().readInt32BE(0)
}
