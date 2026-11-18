import { Button } from '@postdot/ui/components/button'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { PublicationActivityTimeline } from '@/components/publication-activity-timeline'
import { PublicationAdoptionHistory } from '@/components/publication-adoption-history'
import { PublicationCadenceStatus } from '@/components/publication-cadence-status'
import { PublicationCancellationDialog } from '@/components/publication-cancellation-dialog'
import { PublicationCommentsPanel } from '@/components/publication-comments-panel'
import { PublicationDestination } from '@/components/publication-destination'
import { PublicationEditorTargetSection } from '@/components/publication-editor-target-section'
import { PublicationFirstCommentPanel } from '@/components/publication-first-comment-panel'
import { PublicationLifecyclePanel } from '@/components/publication-lifecycle-panel'
import { PublicationMoveDialog } from '@/components/publication-move-dialog'
import {
    PublicationOutcomePanel,
    type PublicationOutcomeResolutionInput,
} from '@/components/publication-outcome-panel'
import { PublicationProfileAdoption } from '@/components/publication-profile-adoption'
import { PublicationThreadProgress } from '@/components/publication-thread-progress'
import { api, ApiError, formatApiError, type PublicationEditorState } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { useProjectPublicationActions } from '@/lib/project-publication-actions'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'
import { providerForProfile } from '@/providers/registry'

import { ManualPublicationKit } from './manual-publication-kit'

export function PostChannelPanel({
    part,
    editor,
    backToCalendar,
    content,
    locked,
    blocked,
    pendingChanges,
    onContentChange,
    onRefresh,
    onAccessRefused,
    getAccessEpoch,
    timeZone,
}: {
    /**
     * "status" is the channel's state strip and its actions, shown above the editor where they
     * act; "details" is everything about this channel version under the editor.
     */
    readonly part: 'status' | 'details'
    readonly backToCalendar?: { readonly date?: string; readonly view?: PublicationCalendarView }
    readonly editor: PublicationEditorState
    readonly content: Record<string, unknown>
    readonly locked: boolean
    readonly blocked: boolean
    readonly pendingChanges: boolean
    readonly onContentChange: (content: Record<string, unknown>) => void
    readonly onRefresh: () => Promise<unknown>
    readonly onAccessRefused: () => void
    readonly getAccessEpoch: () => number
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const { channels, connections } = useProjectDashboard()
    const navigate = useNavigate()
    const actions = useProjectPublicationActions()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [cancelOpen, setCancelOpen] = useState(false)
    const [moveOpen, setMoveOpen] = useState(false)
    const [adoptionOpen, setAdoptionOpen] = useState(false)
    const [optionsOpen, setOptionsOpen] = useState(editor.draft.reviewState !== 'compatible')
    const { publication } = editor
    const provider = providerForProfile(editor.profile.profile)
    const disabled = blocked || pending
    const lifecycleBlocked = disabled || pendingChanges
    async function run(action: () => Promise<boolean>): Promise<boolean> {
        if (disabled) return false
        const epoch = getAccessEpoch()
        setPending(true)
        setError(null)
        try {
            const success = await action()
            if (getAccessEpoch() !== epoch) return false
            if (success) await onRefresh()
            return success
        } catch (caught) {
            if (getAccessEpoch() !== epoch) return false
            if (caught instanceof ApiError && [403, 404].includes(caught.status)) onAccessRefused()
            setError(formatApiError(caught))
            return false
        } finally {
            setPending(false)
        }
    }
    // The outcome panel shows its own refusal and re-enables its choices only when this throws.
    async function reconcile(input: PublicationOutcomeResolutionInput) {
        if (blocked) return
        const epoch = getAccessEpoch()
        try {
            await api.reconcileAmbiguousPublication(publication.projectId, publication.id, input)
        } catch (caught) {
            if (getAccessEpoch() !== epoch) return
            if (caught instanceof ApiError && [403, 404].includes(caught.status)) onAccessRefused()
            throw caught
        }
        if (getAccessEpoch() !== epoch) return
        await onRefresh()
    }
    if (part === 'status') {
        return (
            <div className="min-w-0 space-y-3" data-post-channel-status={publication.id}>
                <PublicationLifecyclePanel
                    publication={publication}
                    timeZone={timeZone}
                    connection={
                        connections.find(
                            connection => connection.channelId === editor.channel.id
                        ) ?? null
                    }
                    readOnly={blocked}
                    pending={lifecycleBlocked}
                    cancelDisabled={lifecycleBlocked}
                    retryDisabled={lifecycleBlocked}
                    onPublish={
                        blocked ? undefined : () => run(() => actions.onPublish(publication.id))
                    }
                    onUndoPublish={
                        blocked
                            ? undefined
                            : () => void run(() => actions.onUndoPublish(publication.id))
                    }
                    onCancel={blocked ? undefined : () => setCancelOpen(true)}
                    onRetry={
                        blocked
                            ? undefined
                            : () =>
                                  run(() => actions.onRetryPublication(publication.id)).then(
                                      retried => {
                                          if (retried) setNotice(m.publication_retry_scheduled())
                                          return retried
                                      }
                                  )
                    }
                    otherActions={
                        !blocked && editor.movement?.canMove ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={lifecycleBlocked}
                                onClick={() => setMoveOpen(true)}>
                                {m.publication_move_action()}
                            </Button>
                        ) : undefined
                    }
                />
                {publication.deliveryMode === 'manual' &&
                ['draft', 'scheduled', 'ready'].includes(publication.state) ? (
                    <ManualPublicationKit editor={editor} content={content} locked={locked} />
                ) : null}
                <PublicationCancellationDialog
                    open={cancelOpen}
                    onOpenChange={setCancelOpen}
                    pending={pending}
                    onCancel={() =>
                        run(() => actions.onCancelPublications([publication.id])).then(
                            cancelled => {
                                if (cancelled) setNotice(m.editor_cancelled())
                                return cancelled
                            }
                        )
                    }
                />
                {moveOpen ? (
                    <PublicationMoveDialog
                        editor={editor}
                        channels={channels}
                        disabled={disabled}
                        onError={onAccessRefused}
                        onClose={() => setMoveOpen(false)}
                        onMoved={async publicationId => {
                            const epoch = getAccessEpoch()
                            await onRefresh()
                            if (epoch !== getAccessEpoch()) return
                            await navigate({
                                to: '/dashboard/projects/$projectId/publications/$publicationId',
                                params: { projectId: publication.projectId, publicationId },
                                search: backToCalendar
                                    ? { ...backToCalendar, from: 'calendar' }
                                    : undefined,
                            })
                        }}
                    />
                ) : null}
                {editor.movement?.fromPublicationId ? (
                    <Link
                        className="text-sm text-link hover:underline"
                        to="/dashboard/projects/$projectId/publications/$publicationId"
                        params={{
                            projectId: publication.projectId,
                            publicationId: editor.movement.fromPublicationId,
                        }}>
                        {m.publication_move_original()}
                    </Link>
                ) : null}
                {editor.movement?.toPublicationId ? (
                    <Link
                        className="text-sm text-link hover:underline"
                        to="/dashboard/projects/$projectId/publications/$publicationId"
                        params={{
                            projectId: publication.projectId,
                            publicationId: editor.movement.toPublicationId,
                        }}>
                        {m.publication_move_replacement()}
                    </Link>
                ) : null}
                {publication.state === 'draft' && editor.movement?.requestedScheduledAt != null ? (
                    <p className="text-sm">
                        {m.publication_move_requested({
                            time: new Intl.DateTimeFormat(locale, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                                timeZone,
                            }).format(editor.movement.requestedScheduledAt),
                        })}
                    </p>
                ) : null}
                {notice ? (
                    <p role="status" className="text-sm text-muted-foreground">
                        {notice}
                    </p>
                ) : null}
                {error ? (
                    <p role="alert" className="text-sm text-state-failed">
                        {error}
                    </p>
                ) : null}
            </div>
        )
    }
    return (
        <div className="mt-5 min-w-0 space-y-4" data-post-channel-panel={publication.id}>
            {error ? (
                <p role="alert" className="text-sm text-state-failed">
                    {error}
                </p>
            ) : null}
            <PublicationEditorTargetSection
                projectId={publication.projectId}
                publicationId={publication.id}
                profile={editor.profile.profile}
                target={content}
                reviewState={editor.draft.reviewState}
                validationIssues={editor.draft.validationIssues}
                disabled={locked || disabled}
                readOnly={locked || blocked}
                open={optionsOpen}
                onOpenChange={setOptionsOpen}
                onTargetChange={onContentChange}
                targetError={null}
                issueCode={issue =>
                    typeof issue.code === 'string' ? issue.code : 'validation_issue'
                }
                issueMessage={() => m.editor_target_validation_issue()}
                summaryTitle={m.editor_content_options()}
                composer
            />
            {!locked && editor.channel.profileVersionId !== editor.draft.profileVersionId ? (
                <Button
                    variant="secondary"
                    disabled={disabled || pendingChanges}
                    onClick={() => setAdoptionOpen(true)}>
                    {m.profile_adoption_title()}
                </Button>
            ) : null}
            {(editor.adoptionCount ?? 0) > 0 ? (
                <PublicationAdoptionHistory
                    projectId={publication.projectId}
                    publicationId={publication.id}
                    revision={editor.draft.revision}
                />
            ) : null}
            {adoptionOpen ? (
                <PublicationProfileAdoption
                    projectId={publication.projectId}
                    editor={editor}
                    localContent={pendingChanges ? content : null}
                    blocked={disabled || locked}
                    onCancel={() => setAdoptionOpen(false)}
                    onError={onAccessRefused}
                    onAdopted={() => {
                        setAdoptionOpen(false)
                        void onRefresh()
                    }}
                />
            ) : null}
            <PublicationThreadProgress messages={editor.threadMessages} />
            {publication.deliveryMode === 'automatic' &&
            ['scheduled', 'ready'].includes(publication.state) ? (
                <PublicationCadenceStatus
                    projectId={publication.projectId}
                    publicationId={publication.id}
                    timeZone={timeZone}
                    locale={locale}
                    readOnly={blocked}
                />
            ) : null}
            <PublicationDestination
                projectId={publication.projectId}
                publicationId={publication.id}
                targetRevisionId={publication.targetRevisionId}
                automatic={publication.deliveryMode === 'automatic'}
                editable={
                    !blocked &&
                    ['draft', 'scheduled', 'ready', 'failed'].includes(publication.state)
                }
                disabled={lifecycleBlocked}
                selectedContent={editor.selectedTarget?.content ?? null}
                selectedProfile={editor.selectedTargetProfile?.profile ?? editor.profile.profile}
                onReviewCurrent={async () => {
                    await onRefresh()
                }}
            />
            <PublicationOutcomePanel
                publication={publication}
                onResolve={reconcile}
                threadMessage={(() => {
                    const uncertain = editor.threadMessages?.find(message =>
                        ['sending', 'ambiguous'].includes(message.state)
                    )
                    return uncertain
                        ? {
                              position: uncertain.position,
                              needsCid:
                                  editor.profile.profile.execution.kind === 'built_in' &&
                                  editor.profile.profile.execution.contractId === 'bluesky',
                          }
                        : undefined
                })()}
            />
            {publication.state === 'published' &&
            publication.externalId &&
            editor.profile.profile.execution.kind === 'built_in' &&
            provider?.comments?.inspectable(publication.externalId, publication.externalUrl) ? (
                <PublicationCommentsPanel
                    provider={editor.profile.profile.execution.contractId}
                    projectId={publication.projectId}
                    publicationId={publication.id}
                    canRefresh={!blocked}
                    timeZone={timeZone}
                    onAccessRefused={onAccessRefused}
                />
            ) : null}
            {editor.profile.profile.execution.kind === 'built_in' &&
            provider?.comments !== undefined &&
            publication.deliveryMode === 'automatic' ? (
                <PublicationFirstCommentPanel
                    projectId={publication.projectId}
                    publicationId={publication.id}
                    publicationState={publication.state}
                    disabled={blocked}
                    timeZone={timeZone}
                    onAccessRefused={onAccessRefused}
                />
            ) : null}
            <details className="group rounded-lg border border-border bg-surface-raised px-3">
                <summary className="cursor-pointer py-3 text-sm font-medium">
                    {m.editor_activity_details()}
                </summary>
                <PublicationActivityTimeline
                    projectId={publication.projectId}
                    publicationId={publication.id}
                    refreshKey={publication.updatedAt}
                    timeZone={timeZone}
                />
            </details>
        </div>
    )
}
