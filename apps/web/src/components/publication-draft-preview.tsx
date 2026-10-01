import { cn } from '@herald/ui/lib/utils'
import { ChatRoundIcon } from '@solar-icons/react/linear/chat-round'
import { EarthIcon } from '@solar-icons/react/linear/earth'
import { HeartIcon } from '@solar-icons/react/linear/heart'
import { MenuDotsIcon } from '@solar-icons/react/linear/menu-dots'
import { RepeatIcon } from '@solar-icons/react/linear/repeat'
import { ShareIcon } from '@solar-icons/react/linear/share'

import previewPaths from '@/assets/platform-preview-icons/paths.json'
import sampleSocialPortrait from '@/assets/sample-social-portrait.jpg'
import { ChannelAvatar } from '@/components/identity-visuals'
import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import type { Channel, MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { getDraftPreviewModel } from '@/lib/publication-preview'
import * as m from '@/paraglide/messages.js'

interface PublicationDraftPreviewProps {
    readonly channel: Channel | undefined
    readonly className?: string
    readonly identityMode?: 'sample' | 'channel'
    readonly media: readonly MediaReference[]
    readonly postContent: string
    readonly postTitle: string
    readonly targetContent?: string
}

export function PublicationDraftPreview({
    channel,
    className,
    identityMode = 'sample',
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
    const article = channel.profileId === 'devto'
    const message = channel.profileId === 'discord'
    const mastodon = channel.profileId === 'mastodon'
    const social = !article && !message
    const accountDriven = ['linkedin', 'x', 'bluesky', 'mastodon', 'devto', 'discord'].includes(
        channel.profileId
    )
    const sampleIdentity = accountDriven && identityMode === 'sample'
    const authorName = sampleIdentity ? m.publication_preview_sample_author() : channel.name
    const hasPreviewBody = preview.hasText || media.length > 0

    return (
        <section
            data-publication-draft-preview="true"
            aria-label={m.publication_new_preview()}
            className={cn('min-w-0', className)}>
            <article
                data-preview-platform={channel.profileId}
                className={cn(
                    'min-w-0 overflow-hidden bg-surface-raised font-[Arial,sans-serif] shadow-surface',
                    linkedIn
                        ? 'rounded-lg border border-[#e8e8e8] bg-white text-[#1f2328]'
                        : message
                          ? 'rounded-md bg-white text-[#313338] dark:bg-[#313338] dark:text-[#dbdee1] [&_.text-muted-foreground]:text-[#60666f] dark:[&_.text-muted-foreground]:text-[#b5bac1]'
                          : article
                            ? 'rounded-md bg-white text-[#171717] dark:bg-[#171717] dark:text-[#f5f5f5] [&_.text-muted-foreground]:text-[#575757] dark:[&_.text-muted-foreground]:text-[#a3a3a3]'
                            : 'rounded-lg'
                )}>
                <header
                    className={cn(
                        'flex min-w-0 items-center gap-2.5',
                        linkedIn ? 'px-3 pt-3 pb-1' : 'px-4 pt-4 pb-2'
                    )}>
                    {sampleIdentity ? (
                        <img
                            alt=""
                            aria-hidden="true"
                            className="size-10 shrink-0 rounded-full object-cover"
                            src={sampleSocialPortrait}
                        />
                    ) : (
                        <ChannelAvatar channel={channel} size="lg" className="rounded-full" />
                    )}
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                            <p className="truncate text-sm font-semibold">{authorName}</p>
                            {message && sampleIdentity ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {m.publication_preview_sample_age()}
                                </span>
                            ) : null}
                        </div>
                        {!linkedIn && !message && sampleIdentity ? (
                            <p className="truncate text-xs text-muted-foreground">
                                {article
                                    ? m.publication_preview_sample_age()
                                    : mastodon
                                      ? '@alex@example.social'
                                      : channel.profileId === 'bluesky'
                                        ? '@alex.example.com'
                                        : '@alex_example'}
                            </p>
                        ) : null}
                        {linkedIn && sampleIdentity ? (
                            <>
                                <p className="truncate text-[11px] text-[#666c72]">
                                    {m.publication_preview_sample_headline()}
                                </p>
                                <p className="flex items-center gap-1 text-[11px] text-[#666c72]">
                                    {m.publication_preview_sample_age()}
                                    <span aria-hidden="true">·</span>
                                    <EarthIcon aria-hidden="true" className="size-3" />
                                </p>
                            </>
                        ) : null}
                    </div>
                    {social ? (
                        <MenuDotsIcon
                            aria-hidden="true"
                            className={cn(
                                'size-5',
                                linkedIn ? 'text-[#666c72]' : 'text-muted-foreground'
                            )}
                        />
                    ) : null}
                </header>

                <div
                    className={cn(
                        'min-w-0',
                        (social && !linkedIn && !mastodon) || message
                            ? 'pl-16 pr-4 pb-4 pt-2'
                            : linkedIn
                              ? 'px-3 pb-2 pt-1'
                              : 'px-4 pb-4 pt-2'
                    )}>
                    {preview.showTitle && preview.title !== '' ? (
                        <h2 className="break-words text-2xl font-bold leading-tight tracking-tight">
                            {preview.title}
                        </h2>
                    ) : null}

                    {preview.hasText ? (
                        <p
                            data-publication-preview-content="true"
                            className={`${preview.showTitle && preview.title !== '' ? 'mt-3' : ''} whitespace-pre-wrap break-words text-sm ${linkedIn ? 'leading-5' : 'leading-6'}`}>
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
                                    className={cn(
                                        'min-w-0 overflow-hidden bg-surface-inset',
                                        linkedIn ? 'rounded-sm' : 'rounded-md'
                                    )}>
                                    <MediaPreview
                                        projectId={asset.asset.projectId}
                                        asset={asset}
                                        representation={readyRepresentation(asset)}
                                        className={cn(
                                            'flex w-full items-center justify-center text-xs font-medium uppercase text-muted-foreground',
                                            media.length === 1
                                                ? 'h-auto max-h-[420px] object-contain'
                                                : 'aspect-[4/3] object-cover'
                                        )}
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
                            <div
                                className={cn(
                                    'h-2 w-4/5 rounded',
                                    linkedIn ? 'bg-[#e5e9ec]' : 'bg-surface-inset'
                                )}
                            />
                            <div
                                className={cn(
                                    'h-2 w-3/5 rounded',
                                    linkedIn ? 'bg-[#e5e9ec]' : 'bg-surface-inset'
                                )}
                            />
                        </div>
                    ) : null}
                </div>
                {linkedIn && hasPreviewBody && sampleIdentity ? (
                    <div
                        data-publication-preview-sample-engagement="true"
                        role="img"
                        aria-label={m.publication_preview_sample_engagement_a11y()}
                        title={m.publication_preview_sample_engagement_a11y()}
                        className="mx-3 flex items-center justify-between gap-2 border-b border-[#e7e9eb] pb-1.5 text-[11px] text-[#666c72]">
                        <span aria-hidden="true" className="flex items-center gap-1.5">
                            <span className="flex -space-x-1">
                                <span className="flex size-4 items-center justify-center rounded-full border border-white bg-[#0a66c2] text-white">
                                    <FeedPreviewGlyph profile="linkedin" action="like" />
                                </span>
                                <span className="flex size-4 items-center justify-center rounded-full border border-white bg-[#e66d74] text-white">
                                    <HeartIcon className="size-2.5" />
                                </span>
                            </span>
                            2
                        </span>
                        <span aria-hidden="true" className="truncate">
                            {m.publication_preview_sample_activity()}
                        </span>
                    </div>
                ) : null}
                {social ? (
                    <div
                        aria-hidden="true"
                        className={cn(
                            'flex items-center justify-between text-muted-foreground [&_svg]:size-4',
                            linkedIn
                                ? 'gap-1 px-3 pb-2 pt-2 text-[11px] text-[#61666b]'
                                : 'max-w-sm px-5 pb-4 pl-16 [&_svg]:size-5'
                        )}>
                        {linkedIn ? (
                            <>
                                <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                                    <FeedPreviewGlyph profile="linkedin" action="like" />
                                    {m.publication_preview_like()}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                                    <FeedPreviewGlyph profile="linkedin" action="reply" />
                                    {m.publication_preview_comment()}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                                    <FeedPreviewGlyph profile="linkedin" action="repost" />
                                    {m.publication_preview_repost()}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                                    <FeedPreviewGlyph profile="linkedin" action="share" />
                                    {m.publication_preview_share()}
                                </span>
                            </>
                        ) : (
                            <>
                                <FeedPreviewGlyph profile={channel.profileId} action="reply" />
                                <FeedPreviewGlyph profile={channel.profileId} action="repost" />
                                <FeedPreviewGlyph profile={channel.profileId} action="like" />
                                <FeedPreviewGlyph profile={channel.profileId} action="share" />
                            </>
                        )}
                    </div>
                ) : null}
            </article>
        </section>
    )
}

function FeedPreviewGlyph({
    profile,
    action,
}: {
    readonly profile: string
    readonly action: 'reply' | 'repost' | 'like' | 'share'
}) {
    const key = `${profile}_${action}` as keyof typeof previewPaths
    const native = previewPaths[key]
    if (native !== undefined)
        return (
            <svg aria-hidden="true" viewBox={native.viewBox} fill="currentColor">
                <path d={native.path} />
            </svg>
        )
    if (profile === 'linkedin')
        return (
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round">
                {action === 'like' ? (
                    <path d="M7 10v11H3V10h4Zm0 0 5-7c1-1 3 0 3 2l-1 5h5c2 0 3 1 2 3l-2 7H7" />
                ) : action === 'reply' ? (
                    <path d="M4 4h16v12H9l-5 4V4Z" />
                ) : action === 'repost' ? (
                    <>
                        <path d="m4 8 4-4 4 4M8 4v12h5" />
                        <path d="m20 16-4 4-4-4M16 20V8h-5" />
                    </>
                ) : (
                    <path d="m3 3 18 9-18 9 4-9-4-9Zm4 9h14" />
                )}
            </svg>
        )
    if (profile === 'x')
        return (
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round">
                {action === 'reply' ? (
                    <path d="M12 3C6.8 3 3 6.3 3 10.8c0 3.5 2.5 6.4 6.2 7.4V22l5-3.6c4-.6 6.8-3.6 6.8-7.6C21 6.3 17.2 3 12 3Z" />
                ) : action === 'repost' ? (
                    <>
                        <path d="m3 7 3-3 3 3M6 4v12a3 3 0 0 0 3 3h4" />
                        <path d="m21 17-3 3-3-3M18 20V8a3 3 0 0 0-3-3h-4" />
                    </>
                ) : action === 'like' ? (
                    <path d="M12 21S2 15.5 2 8.5C2 3.2 8.4 1.5 12 6c3.6-4.5 10-2.8 10 2.5C22 15.5 12 21 12 21Z" />
                ) : (
                    <>
                        <path d="M12 16V3m-4 4 4-4 4 4" />
                        <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
                    </>
                )}
            </svg>
        )
    return action === 'reply' ? (
        <ChatRoundIcon />
    ) : action === 'repost' ? (
        <RepeatIcon />
    ) : action === 'like' ? (
        <HeartIcon />
    ) : (
        <ShareIcon />
    )
}
