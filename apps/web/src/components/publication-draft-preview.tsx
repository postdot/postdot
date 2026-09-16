import { cn } from '@herald/ui/lib/utils'

import { channelProfileLabel } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { Channel, MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { getDraftPreviewModel } from '@/lib/publication-preview'
import * as m from '@/paraglide/messages.js'

interface PublicationDraftPreviewProps {
    readonly channel: Channel | undefined
    readonly className?: string
    readonly media: readonly MediaReference[]
    readonly postContent: string
    readonly postTitle: string
    readonly targetContent?: string
}

export function PublicationDraftPreview({
    channel,
    className,
    media,
    postContent,
    postTitle,
    targetContent,
}: PublicationDraftPreviewProps) {
    useLanguage()

    if (channel === undefined) return null

    const preview = getDraftPreviewModel({
        postContent,
        postTitle,
        profileId: channel.profileId,
        targetContent,
    })

    return (
        <section data-publication-draft-preview="true" className={cn('min-w-0', className)}>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
                <h3 className="font-heading text-lg font-[580] leading-[1.05] tracking-[-0.04em]">
                    {m.publication_new_preview()}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {channelProfileLabel(channel.profileId)}
                </span>
            </div>

            <article className="mt-3 min-w-0 overflow-hidden rounded-md bg-surface-raised">
                <header className="flex min-w-0 items-center gap-3 px-4 py-3">
                    <ChannelAvatar channel={channel} size="md" />
                    <p className="min-w-0 truncate text-sm font-medium">{channel.name}</p>
                </header>

                <div className="min-w-0 bg-surface-field px-4 py-4">
                    {preview.showTitle && preview.title !== '' ? (
                        <h4 className="font-heading text-base font-medium leading-snug tracking-[-0.02em]">
                            {preview.title}
                        </h4>
                    ) : null}

                    {preview.hasText ? (
                        <p
                            data-publication-preview-content="true"
                            className={`${preview.showTitle && preview.title !== '' ? 'mt-3' : ''} whitespace-pre-wrap break-words text-sm leading-6`}>
                            {preview.body}
                        </p>
                    ) : null}

                    {media.length > 0 ? (
                        <div
                            data-publication-preview-media="true"
                            className={`${preview.hasText || (preview.showTitle && preview.title !== '') ? 'mt-4' : ''} grid min-w-0 gap-2 ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                            {media.map(asset => (
                                <div
                                    key={asset.asset.id}
                                    className="min-w-0 overflow-hidden rounded-md bg-surface-inset">
                                    <MediaPreview
                                        projectId={asset.asset.projectId}
                                        asset={asset}
                                        representation={readyRepresentation(asset)}
                                        className="flex aspect-[4/3] w-full items-center justify-center object-cover text-xs font-medium uppercase text-muted-foreground"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {!preview.hasText && media.length === 0 ? (
                        <p
                            data-publication-preview-empty="true"
                            className="min-h-24 content-center text-sm text-muted-foreground">
                            {m.publication_new_preview_empty()}
                        </p>
                    ) : null}
                </div>
            </article>
        </section>
    )
}
