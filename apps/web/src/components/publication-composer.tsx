import { cn } from '@herald/ui/lib/utils'
import type { ReactNode } from 'react'

export interface PublicationComposerProps {
    readonly channelNavigation?: ReactNode
    readonly editor: ReactNode
    readonly footer?: ReactNode
    readonly preview?: ReactNode
    readonly settings?: ReactNode
    readonly className?: string
}

/**
 * Shared workspace frame for creating and editing a publication.
 *
 * The frame owns the responsive composition only. Each workflow can opt into
 * the pieces it supports without creating a second page-specific layout.
 */
export function PublicationComposer({
    channelNavigation,
    className,
    editor,
    footer,
    preview,
    settings,
}: PublicationComposerProps) {
    return (
        <div
            data-publication-composer="true"
            className={cn('mx-auto min-w-0 max-w-6xl space-y-5', className)}>
            {channelNavigation ? <div className="min-w-0">{channelNavigation}</div> : null}

            <div
                className={cn(
                    'grid min-w-0 items-start gap-5',
                    preview ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]' : 'grid-cols-1'
                )}>
                <div className="min-w-0">{editor}</div>
                {preview ? <aside className="min-w-0 lg:sticky lg:top-6">{preview}</aside> : null}
            </div>

            {settings ? <div className="min-w-0">{settings}</div> : null}
            {footer ? <div className="flex justify-end">{footer}</div> : null}
        </div>
    )
}
