import { Button } from '@postdot/ui/components/button'
import { Textarea } from '@postdot/ui/components/textarea'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function PublicationRepliesPanel({
    provider,
    projectId,
    publicationId,
    canSend,
    parent,
    onClose,
    history,
}: {
    provider: 'bluesky' | 'mastodon'
    projectId: string
    publicationId: string
    canSend: boolean
    history: ReturnType<typeof usePublicationReplies>
    parent: { uri: string; handle: string | null } | null
    onClose: () => void
}) {
    const client = useQueryClient()
    const key = ['project', projectId, 'publication-replies', publicationId] as const
    const [text, setText] = useState('')
    const [request, setRequest] = useState<{
        requestId: string
        parentUri: string
        text: string
    } | null>(null)
    const first = history.data?.pages[0]
    const limit = first?.textLimit ?? (provider === 'mastodon' ? 500 : 300)
    const count =
        provider === 'mastodon'
            ? text.length
            : [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
    const platform = provider === 'mastodon' ? 'Mastodon' : 'Bluesky'
    const send = useMutation({
        mutationFn: (body: { requestId: string; parentUri: string; text: string }) =>
            api.sendPublicationReply(projectId, publicationId, body),
        onError: error => {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500)
                setRequest(null)
        },
        onSuccess: () => {
            setText('')
            setRequest(null)
            onClose()
            void client.invalidateQueries({ queryKey: key })
        },
    })
    const outgoing = history.data?.pages.flatMap(page => page.replies) ?? []
    const allowed = canSend && first?.canReply && first.provider === provider
    const labels = {
        pending: m.replies_pending,
        running: m.replies_sending,
        sent: m.replies_sent,
        failed: m.replies_failed,
        ambiguous: m.replies_ambiguous,
    }
    return (
        <section className="space-y-3" aria-label={m.replies_title()}>
            {parent && allowed ? (
                <div className="space-y-3 rounded-md bg-surface-raised p-3">
                    <label htmlFor={`reply-${publicationId}`} className="text-sm font-medium">
                        {m.replies_to({ handle: parent.handle ?? '' })}
                    </label>
                    <p className="text-xs text-muted-foreground">
                        {m.replies_public_as({ account: first.accountName ?? platform })}
                    </p>
                    <Textarea
                        autoFocus
                        id={`reply-${publicationId}`}
                        value={text}
                        maxLength={provider === 'mastodon' ? 500 : 3000}
                        disabled={send.isPending || request !== null}
                        onChange={event => {
                            setText(event.target.value)
                            send.reset()
                        }}
                    />
                    <p
                        className={
                            count > limit
                                ? 'text-xs text-state-failed'
                                : 'text-xs text-muted-foreground'
                        }>
                        {count}/{limit}
                    </p>
                    {send.isError ? (
                        <div role="alert" className="space-y-2 text-sm text-state-failed">
                            <p>
                                {request
                                    ? m.replies_request_failed()
                                    : m.replies_request_rejected()}
                            </p>
                            {request ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => send.mutate(request)}>
                                    {m.common_retry()}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            disabled={
                                !text.trim() || count > limit || send.isPending || request !== null
                            }
                            onClick={() => {
                                const body = {
                                    requestId: crypto.randomUUID(),
                                    parentUri: parent.uri,
                                    text,
                                }
                                setRequest(body)
                                send.mutate(body)
                            }}>
                            {send.isPending ? m.common_loading() : m.replies_send()}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={send.isPending || request !== null}
                            onClick={() => {
                                setText('')
                                onClose()
                            }}>
                            {m.common_cancel()}
                        </Button>
                    </div>
                </div>
            ) : null}
            {history.isError ? (
                <div role="alert" className="text-sm text-state-failed">
                    <p>{m.replies_read_failed()}</p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void history.refetch()}>
                        {m.common_retry()}
                    </Button>
                </div>
            ) : null}
            {canSend && first && !first.canReply ? (
                <p className="text-xs text-muted-foreground">
                    {m.replies_connection_required({ platform })}
                </p>
            ) : null}
            {outgoing.length ? (
                <>
                    <h3 className="text-sm font-medium">{m.replies_title()}</h3>
                    <ol className="space-y-2">
                        {outgoing.map(reply => (
                            <li
                                key={reply.id}
                                className="space-y-2 rounded-md bg-surface-raised p-3 text-sm">
                                <div className="flex flex-wrap justify-between gap-2 text-xs">
                                    <span>{reply.authorName}</span>
                                    <span role="status">{labels[reply.state]()}</span>
                                </div>
                                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                    {reply.text}
                                </p>
                                {reply.state === 'failed' ? (
                                    <p className="text-xs text-state-failed">
                                        {m.replies_failed_help()}
                                    </p>
                                ) : null}
                                {reply.lastError ? (
                                    <details className="text-xs text-muted-foreground">
                                        <summary className="cursor-pointer">
                                            {m.replies_delivery_details()}
                                        </summary>
                                        <p className="mt-1 break-words">{reply.lastError}</p>
                                    </details>
                                ) : null}
                                {reply.state === 'ambiguous' ? (
                                    <p className="text-xs text-state-failed">
                                        {m.replies_ambiguous_help({ platform })}
                                    </p>
                                ) : null}
                                {replyLinkAllowed(
                                    reply.externalUrl,
                                    provider,
                                    first?.instanceOrigin ?? null
                                ) ? (
                                    <a
                                        href={reply.externalUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="text-xs underline">
                                        {m.comments_open_original({ platform })}
                                    </a>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                    {history.hasNextPage ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={history.isFetchingNextPage}
                            onClick={() => void history.fetchNextPage()}>
                            {m.replies_more()}
                        </Button>
                    ) : null}
                </>
            ) : null}
        </section>
    )
}

export function usePublicationReplies(projectId: string, publicationId: string, enabled: boolean) {
    const key = ['project', projectId, 'publication-replies', publicationId] as const
    return useInfiniteQuery({
        queryKey: key,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => api.getPublicationReplies(projectId, publicationId, pageParam),
        getNextPageParam: page => page.nextBefore ?? undefined,
        refetchInterval: query =>
            query.state.data?.pages.some(page =>
                page.replies.some(reply => reply.state === 'pending' || reply.state === 'running')
            )
                ? 2000
                : false,
        refetchOnWindowFocus: false,
        enabled,
    })
}

function replyLinkAllowed(
    url: string | null,
    provider: 'bluesky' | 'mastodon',
    origin: string | null
): url is string {
    if (!url) return false
    if (provider === 'bluesky') return url.startsWith('https://bsky.app/')
    try {
        const parsed = new URL(url)
        return (
            parsed.protocol === 'https:' &&
            !parsed.username &&
            !parsed.password &&
            parsed.origin === origin
        )
    } catch {
        return false
    }
}
