import { Button } from '@postdot/ui/components/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
    PublicationRepliesPanel,
    usePublicationReplies,
} from '@/components/publication-replies-panel'
import { api, ApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

export function PublicationCommentsPanel({
    provider,
    projectId,
    publicationId,
    canRefresh,
    timeZone,
    onAccessRefused,
}: {
    readonly provider: string
    readonly projectId: string
    readonly publicationId: string
    readonly canRefresh: boolean
    readonly timeZone: string
    readonly onAccessRefused?: () => void
}) {
    const { locale } = useLanguage()
    const [open, setOpen] = useState(false)
    const [replyTo, setReplyTo] = useState<{ uri: string; handle: string | null } | null>(null)
    const replies = usePublicationReplies(projectId, publicationId, open)
    const client = useQueryClient()
    const key = ['project', projectId, 'publication-comments', publicationId] as const
    const query = useQuery({
        queryKey: key,
        queryFn: () => api.getPublicationComments(projectId, publicationId),
        enabled: open,
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: 1,
    })
    const refresh = useMutation({
        mutationFn: () => api.refreshPublicationComments(projectId, publicationId),
        onSuccess: response => client.setQueryData(key, response),
        onError: error => {
            if (error instanceof ApiError && (error.status === 403 || error.status === 404))
                onAccessRefused?.()
        },
    })
    const platform = { platform: providerRegistry.get(provider)?.name ?? provider }
    const snapshot = query.data?.snapshot
    const date = (timestamp: number) =>
        new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
        }).format(timestamp)
    return (
        <details
            className="mt-5 min-w-0 rounded-md bg-surface-inset/35 px-4 py-3"
            open={open}
            onToggle={event => setOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium">{m.comments_title()}</summary>
            {open ? (
                <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                            {snapshot
                                ? m.comments_saved_at({ date: date(snapshot.fetchedAt) })
                                : m.comments_not_loaded()}
                        </p>
                        {canRefresh ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={refresh.isPending || query.isPending || query.isError}
                                aria-busy={refresh.isPending}
                                onClick={() => refresh.mutate()}>
                                {refresh.isPending ? m.common_loading() : m.comments_refresh()}
                            </Button>
                        ) : null}
                    </div>
                    {query.isPending ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            {m.common_loading()}
                        </p>
                    ) : query.isError ? (
                        <div role="alert" className="space-y-2 text-sm text-state-failed">
                            <p>{m.comments_read_failed()}</p>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void query.refetch()}>
                                {m.common_retry()}
                            </Button>
                        </div>
                    ) : (
                        <>
                            {refresh.isError || query.data?.lastError ? (
                                <p role="alert" className="text-sm text-state-failed">
                                    {snapshot
                                        ? m.comments_refresh_failed_saved()
                                        : m.comments_refresh_failed()}
                                </p>
                            ) : null}
                            {!snapshot ? (
                                <p className="text-sm text-muted-foreground">
                                    {canRefresh
                                        ? m.comments_start(platform)
                                        : m.comments_awaiting_editor()}
                                </p>
                            ) : snapshot.availability !== 'available' ? (
                                <p className="text-sm text-muted-foreground">
                                    {snapshot.availability === 'not_found'
                                        ? m.comments_thread_missing(platform)
                                        : snapshot.availability === 'blocked'
                                          ? m.comments_thread_blocked(platform)
                                          : m.comments_thread_unavailable(platform)}
                                </p>
                            ) : (
                                <>
                                    <p className="text-xs text-muted-foreground">
                                        {snapshot.truncated
                                            ? m.comments_truncated()
                                            : m.comments_limited_view(platform)}
                                    </p>
                                    {snapshot.comments.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            {m.comments_empty()}
                                        </p>
                                    ) : (
                                        <ol className="space-y-3" aria-label={m.comments_title()}>
                                            {snapshot.comments.map((comment, index) => (
                                                <li
                                                    key={`${comment.id}:${index}`}
                                                    style={{
                                                        marginInlineStart:
                                                            Math.min(comment.depth, 2) * 12,
                                                    }}
                                                    className="min-w-0 rounded-md bg-surface-raised px-3 py-3">
                                                    {comment.availability !== 'available' ? (
                                                        <p className="text-sm text-muted-foreground">
                                                            {m.comments_reply_unavailable()}
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                                                                <span className="break-all font-medium">
                                                                    @{comment.authorHandle}
                                                                </span>
                                                                {comment.createdAt ===
                                                                null ? null : (
                                                                    <time
                                                                        className="text-muted-foreground"
                                                                        dateTime={new Date(
                                                                            comment.createdAt
                                                                        ).toISOString()}>
                                                                        {date(comment.createdAt)}
                                                                    </time>
                                                                )}
                                                            </div>
                                                            <p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                                                                {comment.text}
                                                            </p>
                                                            {canRefresh &&
                                                            replies.data?.pages[0]?.canReply &&
                                                            replyTo === null ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() =>
                                                                        setReplyTo({
                                                                            uri: comment.id,
                                                                            handle: comment.authorHandle,
                                                                        })
                                                                    }>
                                                                    {m.replies_reply()}
                                                                </Button>
                                                            ) : null}
                                                            {commentLinkAllowed(
                                                                comment.externalUrl,
                                                                provider,
                                                                snapshot.rootUri
                                                            ) ? (
                                                                <a
                                                                    href={comment.externalUrl}
                                                                    rel="noreferrer noopener"
                                                                    target="_blank"
                                                                    className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                                                                    {m.comments_open_original(
                                                                        platform
                                                                    )}
                                                                </a>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </>
                            )}
                        </>
                    )}
                    <PublicationRepliesPanel
                        history={replies}
                        provider={provider}
                        projectId={projectId}
                        publicationId={publicationId}
                        canSend={canRefresh}
                        parent={replyTo}
                        onClose={() => setReplyTo(null)}
                    />
                </div>
            ) : null}
        </details>
    )
}

function commentLinkAllowed(url: string | null, provider: string, rootUri: string): url is string {
    if (url === null) return false
    return (
        providerRegistry.get(provider)?.comments?.linkAllowed(
            url,
            (() => {
                try {
                    return new URL(rootUri).origin
                } catch {
                    return null
                }
            })()
        ) ?? false
    )
}
