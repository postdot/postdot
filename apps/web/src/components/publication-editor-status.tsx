import { Button } from '@herald/ui/components/button'
import { cn } from '@herald/ui/lib/utils'
import { DangerTriangleIcon } from '@solar-icons/react/linear/danger-triangle'
import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'

import type { PublicationEditorSaveState } from '@/components/publication-editor-sidebar'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface PublicationEditorStatusProps {
    readonly passive?: boolean
    readonly message: string | null
    readonly saveState: PublicationEditorSaveState
    readonly onReviewConflict: () => void
}

export function PublicationEditorStatus({
    message,
    passive = false,
    saveState,
    onReviewConflict,
}: PublicationEditorStatusProps) {
    useLanguage()
    const needsAttention = saveState === 'error' || saveState === 'conflict'
    if (message !== null && passive && !needsAttention) {
        return (
            <p
                data-publication-editor-message="true"
                data-passive-update="true"
                role="status"
                className="mt-3 px-1 text-xs leading-5 break-words text-muted-foreground">
                {message}
            </p>
        )
    }
    return (
        <>
            {message ? (
                <div
                    data-publication-editor-message="true"
                    role={needsAttention ? 'alert' : 'status'}
                    className={cn(
                        'mt-4 flex min-w-0 flex-wrap items-start gap-2.5 rounded-md px-3 py-2.5 text-sm',
                        needsAttention
                            ? 'bg-state-failed/10 text-state-failed shadow-surface'
                            : 'bg-surface-inset/35 text-muted-foreground'
                    )}>
                    {needsAttention ? (
                        <DangerTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    ) : (
                        <InfoCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    )}
                    <p className="min-w-0 flex-1 basis-48 break-words leading-5">{message}</p>
                    {saveState === 'conflict' ? (
                        <Button size="sm" variant="secondary" onClick={onReviewConflict}>
                            {m.editor_sidebar_reconcile_title()}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </>
    )
}

export function PublicationEditorSaveIndicator({
    state,
    revision,
    showRevision = true,
    compactOnMobile = false,
}: {
    readonly state: PublicationEditorSaveState
    readonly revision: number
    readonly showRevision?: boolean
    readonly compactOnMobile?: boolean
}) {
    useLanguage()
    const label =
        state === 'saved'
            ? m.editor_saved()
            : state === 'saving'
              ? m.editor_saving()
              : state === 'rebasing'
                ? m.editor_rebasing()
                : state === 'local_only'
                  ? m.editor_local_recovery()
                  : state === 'conflict'
                    ? m.editor_conflict()
                    : m.editor_save_failed()

    return (
        <div
            aria-label={label}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            role="status"
            title={label}>
            <span
                className={cn(
                    'size-1.5 rounded-full bg-current',
                    state === 'saved' ? 'text-state-published' : 'text-state-attention'
                )}
                aria-hidden="true"
            />
            <span className={compactOnMobile ? 'sr-only sm:not-sr-only' : undefined}>
                {label}
                {showRevision ? ` · ${m.editor_draft_revision({ revision })}` : null}
            </span>
        </div>
    )
}
