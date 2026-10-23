import { cn } from '@postdot/ui/lib/utils'
import { ChatRoundIcon } from '@solar-icons/react/linear/chat-round'
import { EarthIcon } from '@solar-icons/react/linear/earth'
import { HeartIcon } from '@solar-icons/react/linear/heart'
import { MenuDotsVerticalIcon } from '@solar-icons/react/linear/menu-dots-vertical'
import { RepeatIcon } from '@solar-icons/react/linear/repeat'
import { ShareIcon } from '@solar-icons/react/linear/share'

import sampleSocialPortrait from '@/assets/sample-social-portrait.jpg'
import { ChannelAvatar } from '@/components/identity-visuals'
import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { PublicationArticleBody } from '@/components/publication-article-body'
import { PublicationDiscordBody } from '@/components/publication-discord-body'
import type { Channel, ChannelListItem, MediaReference } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { getNativePlatform } from '@/lib/native-presentation'
import { getDraftPreviewModel } from '@/lib/publication-preview'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

interface PublicationDraftPreviewProps {
    readonly channel: Channel | undefined
    readonly execution: ChannelListItem['execution']
    readonly className?: string
    readonly identityMode?: 'sample' | 'channel'
    readonly media: readonly MediaReference[]
    readonly mediaSelections?: readonly MediaSelection[]
    readonly postContent: string
    readonly postTitle: string
    readonly poll?: unknown
    readonly targetContent?: string
}

export function PublicationDraftPreview({
    channel,
    execution,
    className,
    identityMode = 'sample',
    media,
    mediaSelections,
    postContent,
    postTitle,
    targetContent,
    poll: pollValue,
}: PublicationDraftPreviewProps) {
    useLanguage()

    if (channel === undefined) return null

    const platform = getNativePlatform(execution)
    const preview = getDraftPreviewModel({
        postContent,
        postTitle,
        platform,
        targetContent,
    })

    const definition = providerRegistry.forExecution(execution)
    const professional = definition?.preview.layout === 'professional'
    const Footer = definition?.preview.Footer
    const SampleEngagement = definition?.preview.SampleEngagement
    const Poll = definition?.preview.Poll
    const article = definition?.preview.layout === 'article'
    const message = definition?.preview.layout === 'message'
    const wideContent = definition?.preview.mosaic === 'tight'
    const social = !article && !message
    const accountDriven = definition?.preview.accountDriven ?? false
    const sampleIdentity = definition?.preview.sampleIdentity === true && identityMode === 'sample'
    const authorName = sampleIdentity ? m.publication_preview_sample_author() : channel.name
    const hasPreviewBody = preview.hasText || media.length > 0
    const compactMedia = article || !accountDriven
    const spacedMosaic =
        definition?.preview.mosaic === 'spaced' && media.length >= 2 && media.length <= 4
    const tightMosaic = wideContent && media.length >= 2 && media.length <= 4
    const fittedMosaic = spacedMosaic || tightMosaic

    return (
        <section
            data-publication-draft-preview="true"
            aria-label={m.publication_new_preview()}
            className={cn('min-w-0', className)}>
            <article
                data-preview-platform={platform}
                className={cn(
                    'min-w-0 overflow-hidden bg-surface-raised font-[Arial,sans-serif] shadow-surface',
                    professional
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
                        professional ? 'px-3 pt-3 pb-1' : 'px-4 pt-4 pb-2'
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
                        {!professional && !message && sampleIdentity ? (
                            <p className="truncate text-xs text-muted-foreground">
                                {article
                                    ? m.publication_preview_sample_age()
                                    : wideContent
                                      ? definition?.preview.handle
                                      : (definition?.preview.handle ?? '@alex_example')}
                            </p>
                        ) : null}
                        {professional && sampleIdentity ? (
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
                        <MenuDotsVerticalIcon
                            aria-hidden="true"
                            className={cn(
                                'size-5',
                                professional ? 'text-[#666c72]' : 'text-muted-foreground'
                            )}
                        />
                    ) : null}
                </header>

                <div
                    className={cn(
                        'min-w-0',
                        (social && !professional && !wideContent) || message
                            ? 'pl-16 pr-4 pb-4 pt-2'
                            : professional
                              ? 'px-3 pb-2 pt-1'
                              : 'px-4 pb-4 pt-2'
                    )}>
                    {preview.showTitle && preview.title !== '' ? (
                        <h2 className="break-words text-2xl font-bold leading-tight tracking-tight">
                            {preview.title}
                        </h2>
                    ) : null}

                    {preview.hasText && article ? (
                        <PublicationArticleBody body={preview.body} />
                    ) : preview.hasText && message ? (
                        <PublicationDiscordBody body={preview.body} />
                    ) : preview.hasText ? (
                        <p
                            data-publication-preview-content="true"
                            className={`${preview.showTitle && preview.title !== '' ? 'mt-3' : ''} whitespace-pre-wrap break-words text-sm ${professional ? 'leading-5' : 'leading-6'}`}>
                            {preview.body}
                        </p>
                    ) : null}

                    {Poll ? <Poll poll={pollValue} /> : null}
                    {media.length > 0 ? (
                        <div
                            data-publication-preview-media="true"
                            className={`${preview.hasText || (preview.showTitle && preview.title !== '') ? 'mt-4' : ''} grid min-w-0 ${tightMosaic ? 'gap-0.5' : spacedMosaic ? 'gap-1' : 'gap-2'} ${tightMosaic ? 'aspect-[3/2]' : spacedMosaic && media.length < 4 ? 'aspect-[2/1]' : ''} ${(fittedMosaic && media.length === 3) || (tightMosaic && media.length === 4) ? 'grid-rows-2' : ''} ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                            {media.map((asset, index) => (
                                <div
                                    key={asset.asset.id}
                                    className={cn(
                                        'min-h-0 min-w-0 overflow-hidden bg-surface-inset',
                                        fittedMosaic && media.length === 3 && index === 0
                                            ? 'row-span-2'
                                            : '',
                                        spacedMosaic && media.length === 4 ? 'aspect-[3/2]' : '',
                                        professional ? 'rounded-sm' : 'rounded-md'
                                    )}>
                                    <MediaPreview
                                        playable
                                        alt={
                                            mediaSelections?.find(
                                                selection => selection.assetId === asset.asset.id
                                            )?.accessibilityText ??
                                            asset.asset.defaultAccessibilityText ??
                                            ''
                                        }
                                        projectId={asset.asset.projectId}
                                        asset={asset}
                                        representation={readyRepresentation(asset)}
                                        className={cn(
                                            'flex w-full items-center justify-center text-xs font-medium uppercase text-muted-foreground',
                                            compactMedia
                                                ? media.length === 1
                                                    ? 'h-auto max-h-44 object-contain'
                                                    : 'h-28 object-cover'
                                                : fittedMosaic
                                                  ? 'h-full object-cover'
                                                  : media.length === 1
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
                                    professional ? 'bg-[#e5e9ec]' : 'bg-surface-inset'
                                )}
                            />
                            <div
                                className={cn(
                                    'h-2 w-3/5 rounded',
                                    professional ? 'bg-[#e5e9ec]' : 'bg-surface-inset'
                                )}
                            />
                        </div>
                    ) : null}
                </div>
                {SampleEngagement && hasPreviewBody && sampleIdentity ? <SampleEngagement /> : null}
                {social ? (
                    <div
                        aria-hidden="true"
                        className={cn(
                            'flex items-center justify-between text-muted-foreground [&_svg]:size-4',
                            definition?.preview.footerClassName ??
                                'max-w-sm px-5 pb-4 pl-16 [&_svg]:size-5'
                        )}>
                        {Footer ? (
                            <Footer />
                        ) : (
                            <>
                                <FeedPreviewGlyph profile={platform} action="reply" />
                                <FeedPreviewGlyph profile={platform} action="repost" />
                                <FeedPreviewGlyph profile={platform} action="like" />
                                <FeedPreviewGlyph profile={platform} action="share" />
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
    const definition = providerRegistry.get(profile)
    const native = definition?.glyphs?.[action]
    if (native)
        return (
            <svg aria-hidden="true" viewBox={native.viewBox} fill="currentColor">
                <path d={native.path} />
            </svg>
        )
    const Glyph = definition?.Glyph
    if (Glyph) return <Glyph action={action} />
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
