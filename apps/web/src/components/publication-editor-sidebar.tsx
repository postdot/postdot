import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'

import type { PublicationEditorState } from '@/lib/api'
import { formatProjectDateTime } from '@/lib/date-time'

export type PublicationEditorSaveState =
    | 'saved'
    | 'saving'
    | 'rebasing'
    | 'local_only'
    | 'conflict'
    | 'error'

export interface CapabilitySummary {
    readonly textFields: readonly {
        readonly bindingId: string
        readonly maxLength: number | null
        readonly acceptedSourceFormats: readonly string[]
    }[]
    readonly mediaFieldCount: number
}

interface PublicationEditorSidebarProps {
    readonly editor: PublicationEditorState
    readonly capabilitySummary: CapabilitySummary
    readonly timeZone: string
    readonly sourceConflict: boolean
    readonly saveState: PublicationEditorSaveState
    readonly isRebasing: boolean
    readonly recoveryAvailable: boolean
    readonly hasLocalChanges: boolean
    readonly onRebase: () => void
    readonly onReload: () => void
    readonly onRestore: () => void
}

export function PublicationEditorSidebar({
    editor,
    capabilitySummary,
    timeZone,
    sourceConflict,
    saveState,
    isRebasing,
    recoveryAvailable,
    hasLocalChanges,
    onRebase,
    onReload,
    onRestore,
}: PublicationEditorSidebarProps) {
    return (
        <aside className="min-w-0 space-y-8 xl:sticky xl:top-20 xl:self-start">
            <section className="min-w-0 rounded-md bg-muted p-5 shadow-surface">
                <p className="text-xs font-medium text-muted-foreground">Selected target</p>
                <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                    Delivery snapshot
                </h2>
                {editor.selectedTarget === null ? (
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">
                        No target has been promoted yet. This publication remains a draft.
                    </p>
                ) : (
                    <div className="mt-4 space-y-3 text-sm">
                        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                            <dt className="text-muted-foreground">Revision</dt>
                            <dd className="font-medium">{editor.selectedTarget.sequence}</dd>
                            <dt className="text-muted-foreground">Profile</dt>
                            <dd className="truncate font-medium">
                                {editor.selectedTarget.profileVersionId}
                            </dd>
                            <dt className="text-muted-foreground">Scheduled</dt>
                            <dd className="font-medium">
                                {formatProjectDateTime(editor.publication.scheduledAt, timeZone)}
                            </dd>
                        </dl>
                        <pre className="max-h-72 max-w-full overflow-auto rounded-md bg-surface-field p-3 font-mono text-xs leading-5 shadow-field">
                            {formatJson(editor.selectedTarget.content)}
                        </pre>
                    </div>
                )}
            </section>

            <section className="min-w-0 pt-2">
                <p className="text-xs font-medium text-muted-foreground">Channel contract</p>
                <h2 className="mt-2 font-heading text-xl font-[580] leading-[1.03] tracking-[-0.04em]">
                    Capability feedback
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Profile {editor.profile.profileId} v{editor.profile.version} · schema
                    {` ${editor.profile.profile.schemaHash ?? 'unhashed'}`}
                </p>
                <div className="mt-5 space-y-3 text-sm">
                    {capabilitySummary.textFields.map(field => (
                        <div
                            key={field.bindingId}
                            className="rounded-md bg-muted px-3 py-2 shadow-field">
                            <p className="font-medium">{field.bindingId}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {field.maxLength === null
                                    ? 'No declared length limit'
                                    : `Maximum ${field.maxLength} characters`}{' '}
                                · {field.acceptedSourceFormats.join(', ') || 'No source format'}
                            </p>
                        </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                        {capabilitySummary.mediaFieldCount} media field
                        {capabilitySummary.mediaFieldCount === 1 ? '' : 's'} declared.
                    </p>
                </div>
            </section>

            {sourceConflict || saveState === 'conflict' ? (
                <Alert
                    variant="destructive"
                    className="rounded-md border-destructive/35 bg-destructive/5 px-4 py-5">
                    <AlertTitle>
                        {sourceConflict
                            ? 'Source revision needs review'
                            : 'Reconcile before continuing'}
                    </AlertTitle>
                    <AlertDescription>
                        {sourceConflict
                            ? `This draft was authored from source revision ${editor.draft.sourceRevision}, but the shared post is now at revision ${editor.post.sourceRevision}. The target payload is preserved until you explicitly choose what to keep.`
                            : 'Another editor committed a newer draft revision. Keep your local copy or load the server version before writing again.'}
                    </AlertDescription>
                    {sourceConflict ? (
                        <div className="mt-4 grid min-w-0 gap-3 text-xs sm:grid-cols-2">
                            <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                <p className="font-medium text-foreground">
                                    Draft source · revision {editor.draft.sourceRevision}
                                </p>
                                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-5 text-muted-foreground">
                                    {formatJson(editor.draft.baseSourceContent)}
                                </pre>
                            </div>
                            <div className="min-w-0 rounded-md bg-background/60 p-3 shadow-field">
                                <p className="font-medium text-foreground">
                                    Current source · revision {editor.post.sourceRevision}
                                </p>
                                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-5 text-muted-foreground">
                                    {formatJson(editor.post.sourceContent)}
                                </pre>
                            </div>
                        </div>
                    ) : null}
                    <div className="mt-4 grid gap-2">
                        {sourceConflict ? (
                            <Button size="sm" onClick={onRebase} disabled={isRebasing}>
                                Rebase draft to current source
                            </Button>
                        ) : null}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onReload}
                            disabled={isRebasing}>
                            Load server version
                        </Button>
                        {recoveryAvailable || hasLocalChanges ? (
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={onRestore}
                                disabled={isRebasing}>
                                Load local copy for review
                            </Button>
                        ) : null}
                    </div>
                </Alert>
            ) : null}
        </aside>
    )
}

function formatJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}
