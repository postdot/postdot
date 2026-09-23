import type { MediaAssetUsage } from '@/lib/api'

export function mediaCanBeDeleted(usage: MediaAssetUsage | null): boolean {
    return (
        usage !== null &&
        usage.active.length === 0 &&
        usage.history.length === 0 &&
        usage.auditEventCount === 0
    )
}
