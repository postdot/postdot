import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'

import { formatCivilSchedule } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import type { PublicationComposerDraftContent } from '@/lib/publication-recovery'
import * as m from '@/paraglide/messages.js'

export function ComposerDraftConflict({
    local,
    saved,
    channels,
    timeZone,
    busy,
    savedKnown,
    error,
    onRefresh,
    onUseSaved,
    onSaveLocal,
    onClose,
}: {
    readonly local: PublicationComposerDraftContent
    readonly saved: PublicationComposerDraftContent | null
    readonly channels: readonly { id: string; name: string }[]
    readonly timeZone: string
    readonly savedKnown: boolean
    readonly busy: boolean
    readonly error: string | null
    readonly onRefresh: () => void
    readonly onUseSaved: () => void
    readonly onSaveLocal: () => void
    readonly onClose: () => void
}) {
    const { locale } = useLanguage()
    function download() {
        const blob = new Blob([JSON.stringify({ local, saved }, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'postdot-draft-versions.json'
        anchor.click()
        URL.revokeObjectURL(url)
    }
    function version(content: PublicationComposerDraftContent | null, label: string) {
        return (
            <section
                aria-label={label}
                className="min-w-0 space-y-3 rounded-md bg-surface-inset p-3">
                <h3 className="font-medium">{label}</h3>
                {content === null ? (
                    <p className="text-muted-foreground">{m.composer_conflict_removed()}</p>
                ) : (
                    <>
                        {content.postTitle ? (
                            <p className="break-words font-medium">{content.postTitle}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words text-sm">
                            {content.postContent}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {m.nav_media()}: {content.sourceMedia.length} · {m.taxonomy_tags()}:{' '}
                            {content.publicationTagIds.length}
                        </p>
                        {content.publicationTargets.map(target => (
                            <div key={target.id} className="space-y-1 text-sm">
                                <h4 className="font-medium">
                                    {channels.find(channel => channel.id === target.channelId)
                                        ?.name ?? m.nav_channels()}
                                </h4>
                                {target.content ? (
                                    <p className="whitespace-pre-wrap break-words">
                                        {target.content}
                                    </p>
                                ) : null}
                                <p className="text-xs text-muted-foreground">
                                    {target.deliveryMode === 'manual'
                                        ? m.common_manual()
                                        : m.common_automatic()}{' '}
                                    ·{' '}
                                    {formatCivilSchedule(target.scheduledAt, locale) ||
                                        m.publication_unscheduled()}{' '}
                                    · {timeZone}
                                </p>
                            </div>
                        ))}
                    </>
                )}
            </section>
        )
    }
    return (
        <Dialog
            open
            onOpenChange={open => {
                if (!open && !busy) onClose()
            }}>
            <DialogContent
                className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
                data-composer-conflict="true"
                showCloseButton={!busy}>
                <DialogHeader>
                    <DialogTitle>{m.composer_conflict_title()}</DialogTitle>
                    <DialogDescription>{m.composer_conflict_choice()}</DialogDescription>
                </DialogHeader>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {version(local, m.composer_conflict_local())}
                    {savedKnown ? (
                        version(saved, m.composer_conflict_saved())
                    ) : (
                        <p role="status">{m.composer_conflict_read_failed()}</p>
                    )}
                </div>
                {error ? (
                    <p role="alert" className="text-sm text-state-failed">
                        {error}
                    </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                    <Button
                        disabled={busy || !savedKnown}
                        onClick={download}
                        variant="ghost"
                        size="sm">
                        {m.composer_conflict_download()}
                    </Button>
                    <Button disabled={busy} onClick={onRefresh} variant="ghost" size="sm">
                        {m.composer_conflict_refresh()}
                    </Button>
                </div>
                <DialogFooter>
                    <Button
                        disabled={
                            busy ||
                            !savedKnown ||
                            (!local.postContent.trim() &&
                                !local.postTitle.trim() &&
                                local.sourceMedia.length === 0 &&
                                local.publicationTargets.every(target => !target.content.trim()))
                        }
                        onClick={onSaveLocal}
                        variant="destructive">
                        {m.composer_conflict_replace()}
                    </Button>
                    <Button disabled={busy || !savedKnown} onClick={onUseSaved}>
                        {saved === null
                            ? m.composer_conflict_start_new()
                            : m.composer_conflict_use_saved()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
