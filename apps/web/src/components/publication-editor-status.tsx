import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { cn } from '@herald/ui/lib/utils'

import type { PublicationEditorSaveState } from '@/components/publication-editor-sidebar'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

interface PublicationEditorStatusProps {
    readonly isRebasing: boolean
    readonly message: string | null
    readonly recoveryAvailable: boolean
    readonly saveState: PublicationEditorSaveState
    readonly onDiscardRecovery: () => void
    readonly onRestoreRecovery: () => void
}

export function PublicationEditorStatus({
    isRebasing,
    message,
    recoveryAvailable,
    saveState,
    onDiscardRecovery,
    onRestoreRecovery,
}: PublicationEditorStatusProps) {
    useLanguage()
    return (
        <>
            {message ? (
                <Alert
                    variant={
                        saveState === 'error' || saveState === 'conflict'
                            ? 'destructive'
                            : 'default'
                    }
                    className={cn(
                        'mt-6 rounded-md',
                        saveState === 'error' || saveState === 'conflict'
                            ? 'border-destructive/35 bg-destructive/10'
                            : 'border-border/70 bg-muted/35'
                    )}>
                    <AlertTitle>
                        {saveState === 'error'
                            ? m.editor_save_failed()
                            : saveState === 'conflict'
                              ? m.editor_sidebar_conflict_title()
                              : m.editor_status()}
                    </AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            ) : null}

            {recoveryAvailable ? (
                <div className="mt-4 flex flex-col gap-3 rounded-md bg-state-attention/10 px-4 py-3 text-sm ring-1 ring-state-attention/30 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-foreground">{m.editor_recovery_available()}</p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={onRestoreRecovery}
                            disabled={isRebasing}>
                            {m.editor_restore_recovery()}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onDiscardRecovery}
                            disabled={isRebasing}>
                            {m.editor_discard_recovery()}
                        </Button>
                    </div>
                </div>
            ) : null}
        </>
    )
}

export function PublicationEditorSaveIndicator({
    state,
    revision,
}: {
    readonly state: PublicationEditorSaveState
    readonly revision: number
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
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span
                className={cn(
                    'size-1.5 rounded-full bg-current',
                    state === 'saved' ? 'text-state-published' : 'text-state-attention'
                )}
                aria-hidden="true"
            />
            {label} · {m.editor_draft_revision({ revision })}
        </div>
    )
}
