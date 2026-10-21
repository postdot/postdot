import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, formatApiError, type FacebookPageChoices } from '@/lib/api'
import { useConnectionAction } from '@/lib/use-connection-action'
import * as m from '@/paraglide/messages.js'

type PageChoice = FacebookPageChoices['pages'][number] & { readonly after?: string }

export function FacebookPagePickerDialog({
    projectId,
    channelId,
    channelName,
    selection,
    onClose,
    onConnected,
    loadPages = api.listFacebookPages,
    connectPage = api.selectFacebookPage,
}: {
    readonly projectId: string
    readonly channelId: string
    readonly channelName: string
    readonly selection: string
    readonly onClose: () => void
    readonly onConnected: () => Promise<void>
    readonly loadPages?: typeof api.listFacebookPages
    readonly connectPage?: (...args: Parameters<typeof api.selectFacebookPage>) => Promise<unknown>
}) {
    const [pages, setPages] = useState<PageChoice[]>([])
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [chosenId, setChosenId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [restart, setRestart] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const generation = useRef(0)
    const loadingMore = useRef(false)
    const { submitting, error, run } = useConnectionAction()
    useEffect(() => {
        const current = ++generation.current
        setPages([])
        setChosenId(null)
        setNextCursor(null)
        setLoading(true)
        setLoadError(null)
        setRestart(false)
        void loadPages(projectId, channelId, selection)
            .then(result => {
                if (generation.current !== current) return
                setPages([...result.pages])
                setNextCursor(result.nextCursor)
            })
            .catch(error => {
                if (generation.current !== current) return
                const invalid = error instanceof ApiError && error.code === 'invalid_attempt'
                setRestart(invalid)
                setLoadError(invalid ? m.provider_facebook_pages_restart() : formatApiError(error))
            })
            .finally(() => {
                if (generation.current === current) setLoading(false)
            })
        return () => {
            generation.current++
        }
    }, [projectId, channelId, selection, loadPages, attempt])

    async function more() {
        if (!nextCursor || loadingMore.current) return
        loadingMore.current = true
        const current = generation.current
        const after = nextCursor
        setLoading(true)
        setLoadError(null)
        try {
            const result = await loadPages(projectId, channelId, selection, after)
            if (generation.current !== current) return
            setPages(previous => [
                ...previous,
                ...result.pages
                    .filter(page => !previous.some(item => item.id === page.id))
                    .map(page => ({ ...page, after })),
            ])
            setNextCursor(result.nextCursor === after ? null : result.nextCursor)
        } catch (error) {
            if (generation.current === current) setLoadError(formatApiError(error))
        } finally {
            loadingMore.current = false
            if (generation.current === current) setLoading(false)
        }
    }
    const selected = pages.find(page => page.id === chosenId && page.hasPublishTask)
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open && !submitting) onClose()
            }}>
            <DialogContent className="flex flex-col max-h-[min(38rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] overflow-hidden sm:max-w-md">
                <form
                    className="flex min-h-0 flex-col gap-4"
                    aria-busy={submitting}
                    onSubmit={event => {
                        event.preventDefault()
                        if (!selected || loading) return
                        void run(async () => {
                            try {
                                await connectPage(projectId, channelId, {
                                    selection,
                                    pageId: selected.id,
                                    after: selected.after,
                                })
                                await onConnected()
                            } catch (caught) {
                                if (
                                    caught instanceof ApiError &&
                                    ['invalid_attempt', 'conflict'].includes(caught.code)
                                ) {
                                    setRestart(true)
                                    setLoadError(m.provider_facebook_pages_restart())
                                }
                                throw caught
                            }
                        })
                    }}>
                    <DialogHeader className="shrink-0">
                        <DialogTitle>{m.provider_facebook_pages_title()}</DialogTitle>
                        <DialogDescription>{channelName}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 space-y-3 overflow-y-auto">
                        <fieldset
                            disabled={submitting || loading}
                            className="grid gap-1"
                            aria-label={m.provider_facebook_pages_title()}>
                            {pages.map(page => (
                                <label
                                    key={page.id}
                                    className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-3 ${chosenId === page.id ? 'border-primary bg-primary/5' : 'border-border'} ${!page.hasPublishTask ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted/50'}`}>
                                    <input
                                        type="radio"
                                        name="facebook-page"
                                        value={page.id}
                                        checked={chosenId === page.id}
                                        disabled={!page.hasPublishTask}
                                        onChange={() => setChosenId(page.id)}
                                        className="size-4 shrink-0 accent-primary"
                                    />
                                    <span className="min-w-0">
                                        <span className="block break-words text-sm font-medium">
                                            {page.name}
                                        </span>
                                        {!page.hasPublishTask ? (
                                            <span className="block text-xs text-muted-foreground">
                                                {m.provider_facebook_pages_access()}
                                            </span>
                                        ) : null}
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                        {loading ? (
                            <p role="status" className="text-sm text-muted-foreground">
                                {m.common_loading()}
                            </p>
                        ) : null}
                        {!loading && !loadError && pages.length === 0 ? (
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    {m.provider_facebook_pages_empty()}
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAttempt(value => value + 1)}>
                                    {m.common_retry()}
                                </Button>
                            </div>
                        ) : null}
                        {loadError ? (
                            <p role="alert" className="text-sm text-destructive">
                                {loadError}
                            </p>
                        ) : null}
                        {error && !restart ? (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        ) : null}
                        {loadError && !restart ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={loading || submitting}
                                onClick={() =>
                                    nextCursor ? void more() : setAttempt(value => value + 1)
                                }>
                                {m.common_retry()}
                            </Button>
                        ) : null}
                        {nextCursor && !loadError ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={loading || submitting}
                                onClick={() => void more()}>
                                {m.provider_facebook_pages_more()}
                            </Button>
                        ) : null}
                    </div>
                    <DialogFooter className="shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={submitting}
                            onClick={onClose}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            type="submit"
                            disabled={!selected || loading || submitting || restart}>
                            {m.provider_facebook_pages_connect()}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
