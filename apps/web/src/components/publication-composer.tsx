import { cn } from '@postdot/ui/lib/utils'
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
            className={cn(
                'mx-auto grid min-w-0 max-w-6xl items-start gap-5',
                preview ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]' : 'grid-cols-1',
                className
            )}>
            {channelNavigation ? (
                <div className="min-w-0 lg:col-span-full">{channelNavigation}</div>
            ) : null}
            <div data-composer-editor="true" className="min-w-0">
                {editor}
            </div>
            {settings ? (
                <div data-composer-settings="true" className="min-w-0 lg:col-span-full">
                    {settings}
                </div>
            ) : null}
            {footer ? (
                <div
                    data-composer-actions="true"
                    className="flex min-w-0 justify-end lg:col-span-full">
                    {footer}
                </div>
            ) : null}
            {preview ? (
                <div
                    data-composer-preview="true"
                    className={cn(
                        'min-w-0 lg:col-start-2',
                        channelNavigation ? 'lg:row-start-2' : 'lg:row-start-1'
                    )}>
                    {preview}
                </div>
            ) : null}
        </div>
    )
}
