import { Skeleton } from '@postbot/ui/components/skeleton'

import type { MediaLibraryViewMode } from '@/lib/media-library-view'
import * as m from '@/paraglide/messages.js'

import { mediaLibraryGridClass } from './media-asset-collection'

/** Reserve the same preview and text regions as the selected library view. */
export function MediaLibrarySkeleton({
    viewMode = 'grid',
}: {
    readonly viewMode?: MediaLibraryViewMode
}) {
    const grid = viewMode === 'grid'
    const compact = viewMode === 'compact'
    return (
        <div
            role="status"
            aria-label={m.media_loading()}
            aria-busy="true"
            data-media-library-loading="true"
            className={`mt-4 grid gap-3 ${mediaLibraryGridClass(viewMode)}`}>
            {Array.from({ length: 6 }, (_, index) => (
                <div
                    key={index}
                    aria-hidden="true"
                    className={`rounded-lg bg-surface-raised p-3 ${grid ? '' : 'flex items-center gap-3'}`}>
                    <Skeleton
                        className={`bg-surface-control motion-reduce:animate-none ${grid ? 'aspect-[4/3] w-full' : compact ? 'size-12 shrink-0' : 'size-20 shrink-0'}`}
                    />
                    <div className={`min-w-0 flex-1 space-y-2 ${grid ? 'mt-3' : ''}`}>
                        <Skeleton className="h-3.5 w-3/4 bg-surface-control motion-reduce:animate-none" />
                        <Skeleton className="h-3 w-1/2 bg-surface-control motion-reduce:animate-none" />
                    </div>
                </div>
            ))}
        </div>
    )
}
