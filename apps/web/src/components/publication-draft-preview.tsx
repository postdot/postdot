import { cn } from '@herald/ui/lib/utils'
import { ChatRoundIcon } from '@solar-icons/react/linear/chat-round'
import { HeartIcon } from '@solar-icons/react/linear/heart'
import { LikeIcon } from '@solar-icons/react/linear/like'
import { MenuDotsIcon } from '@solar-icons/react/linear/menu-dots'
import { RepeatIcon } from '@solar-icons/react/linear/repeat'
import { ShareIcon } from '@solar-icons/react/linear/share'

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

    const linkedIn = channel.profileId === 'linkedin'
    const social = linkedIn || ['bluesky', 'mastodon', 'x'].includes(channel.profileId)

    return (
        <section data-publication-draft-preview="true" className={cn('min-w-0', className)}>
            <p className="mb-3 text-xs font-medium text-muted-foreground">
                {m.publication_new_preview()}
            </p>
            <article
                data-preview-platform={channel.profileId}
                className={cn(
                    'min-w-0 overflow-hidden bg-surface-raised shadow-surface',
                    linkedIn ? 'rounded-lg' : 'rounded-2xl'
                )}>
                <header className="flex min-w-0 items-center gap-3 px-4 pt-4 pb-2">
                    <ChannelAvatar
                        channel={channel}
                        size="lg"
                        className={linkedIn ? 'rounded-md' : 'rounded-full'}
                    />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{channel.name}</p>
                        {linkedIn ? (
                            <span className="text-xs text-muted-foreground">LinkedIn</span>
                        ) : null}
                    </div>
                    {social ? (
                        <MenuDotsIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                    ) : null}
                </header>

                <div
                    className={cn(
                        'min-w-0 pb-4 pt-2',
                        social && !linkedIn ? 'pl-16 pr-4' : 'px-4'
                    )}>
                    {preview.showTitle && preview.title !== '' ? (
                        <h4 className="font-heading text-base font-medium leading-snug">
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
                        <div
                            data-publication-preview-empty="true"
                            aria-hidden="true"
                            className="space-y-2 py-4">
                            <div className="h-2 w-4/5 rounded bg-surface-inset" />
                            <div className="h-2 w-3/5 rounded bg-surface-inset" />
                        </div>
                    ) : null}
                </div>
                {social ? (
                    <div
                        aria-hidden="true"
                        className={cn(
                            'flex items-center justify-between px-5 pb-4 text-muted-foreground [&_svg]:size-5',
                            linkedIn ? 'gap-2 pt-2 text-[11px]' : 'max-w-sm pl-16'
                        )}>
                        {linkedIn ? (
                            <>
                                <span className="flex flex-col items-center gap-1">
                                    <LikeIcon />
                                    {m.publication_preview_like()}
                                </span>
                                <span className="flex flex-col items-center gap-1">
                                    <ChatRoundIcon />
                                    {m.publication_preview_comment()}
                                </span>
                                <span className="flex flex-col items-center gap-1">
                                    <RepeatIcon />
                                    {m.publication_preview_repost()}
                                </span>
                                <span className="flex flex-col items-center gap-1">
                                    <ShareIcon />
                                    {m.publication_preview_share()}
                                </span>
                            </>
                        ) : (
                            <>
                                <ChatRoundIcon />
                                <RepeatIcon />
                                <HeartIcon />
                                <ShareIcon />
                            </>
                        )}
                    </div>
                ) : null}
            </article>
        </section>
    )
}
