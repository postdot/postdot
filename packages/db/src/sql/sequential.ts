/**
 * Maps items one after another, awaiting each result before starting the
 * next. Store code uses it instead of `Array.prototype.map` with an async
 * callback, which would start every statement at once and return promises.
 * Sequential execution keeps statement order deterministic inside a
 * transaction, as it was when persistence was synchronous (ADR-097).
 */
export async function mapSequential<T, R>(
    items: readonly T[],
    operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = []
    for (const [index, item] of items.entries()) results.push(await operation(item, index))
    return results
}

/** Sequential `every`: stops at the first item that does not match. */
export async function everySequential<T>(
    items: readonly T[],
    predicate: (item: T, index: number) => Promise<boolean>
): Promise<boolean> {
    for (const [index, item] of items.entries()) {
        if (!(await predicate(item, index))) return false
    }
    return true
}

/** Sequential `some`: stops at the first matching item. */
export async function someSequential<T>(
    items: readonly T[],
    predicate: (item: T, index: number) => Promise<boolean>
): Promise<boolean> {
    for (const [index, item] of items.entries()) {
        if (await predicate(item, index)) return true
    }
    return false
}

/** Sequential `filter`: keeps items whose awaited predicate holds, in order. */
export async function filterSequential<T>(
    items: readonly T[],
    predicate: (item: T, index: number) => Promise<boolean>
): Promise<T[]> {
    const kept: T[] = []
    for (const [index, item] of items.entries()) {
        if (await predicate(item, index)) kept.push(item)
    }
    return kept
}
