import { publicationTagFilterMaximumIds } from '@postdot/core'

/**
 * Maximum number of tag IDs a Performance tag selection may carry.
 *
 * The transport rejects a longer selection, so the browser normalizes to the
 * same bound instead of sending a request that is guaranteed to fail.
 */
export const performanceTagSelectionLimit = publicationTagFilterMaximumIds

/**
 * Normalize a Performance tag selection.
 *
 * Tag IDs form an unordered set: blank values are dropped, duplicates collapse
 * and the remaining IDs are sorted, so the same selection always produces the
 * same query key and the same request. The selection stays within the
 * transport bound.
 */
export function normalizePerformanceTagSelection(tagIds: readonly string[]): string[] {
    const normalized = [
        ...new Set(tagIds.map(tagId => tagId.trim()).filter(tagId => tagId.length > 0)),
    ]
    normalized.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    return normalized.slice(0, performanceTagSelectionLimit)
}

/**
 * Read a Performance tag selection from a route search value.
 *
 * The selection arrives either as a JSON array or as a comma-separated list.
 * An unknown or empty selection resolves to no filter at all.
 */
export function parsePerformanceTagSelection(value: unknown): string[] | undefined {
    const values = Array.isArray(value) ? value : [value]
    const selection = normalizePerformanceTagSelection(
        values.flatMap(item => (typeof item === 'string' ? item.split(',') : []))
    )
    return selection.length > 0 ? selection : undefined
}

/**
 * Stable query-key fragment for a Performance tag selection.
 */
export function performanceTagSelectionKey(tagIds: readonly string[]): string {
    return normalizePerformanceTagSelection(tagIds).join('\u0000')
}
