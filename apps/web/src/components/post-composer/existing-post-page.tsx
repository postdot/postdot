import { Button, buttonVariants } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@postdot/ui/components/dialog'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Link, useNavigate, useBlocker } from '@tanstack/react-router'
import { lazy, Suspense, useState, useEffect, useRef, type SetStateAction } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationStatus, formatSchedule } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import { LanguageCombobox } from '@/components/language-combobox'
import { PostSourceReview } from '@/components/post-source-review'
import { PublicationEditorSidebar } from '@/components/publication-editor-sidebar'
import {
    PublicationEditorSaveIndicator,
    PublicationEditorStatus,
} from '@/components/publication-editor-status'
import {
    PublicationRecoveryComparison,
    recoveryComparisonChanges,
} from '@/components/publication-recovery-comparison'
import { PublicationTargetEditor } from '@/components/publication-target-editor'
import { useProjectLifecycle } from '@/components/resource-lifecycle-section'
import { ApiError } from '@/lib/api'
import {
    applyPostToChannel,
    channelVersionFollowsSource,
    postFromChannelVersion,
} from '@/lib/channel-version-follow'
import { useDashboardUserId, useProjectDashboard } from '@/lib/dashboard-context'
import { toDateTimeLocal } from '@/lib/date-time'
import { useLanguage } from '@/lib/i18n'
import { countStaleChannelVersions } from '@/lib/post-source-review'
import type { PublicationCalendarView } from '@/lib/publication-calendar-events'
import { shortExcerpt } from '@/lib/publication-identity'
import { getTargetPreviewBody } from '@/lib/publication-preview'
import { getTargetEditorFields } from '@/lib/target-editor'
import { getTargetMediaSelections, type MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

import { ExistingPostChannels } from './existing-post-channels'
import {
    channelHasPendingChanges,
    compositionChannelContent,
    compositionSource,
} from './existing-post-composition'
import { ExistingPostTags } from './existing-post-tags'
import { PostChannelPreview } from './post-channel-preview'
import { PostComposer } from './post-composer'
import { recoveryMatchesProfiles } from './post-composition-recovery'
import { useExistingPostComposition, type ExistingPostData } from './use-existing-post-composition'
import { useMediaReferences } from './use-media-references'
import { usePostEditorAccess } from './use-post-editor-access'

const PostChannelPanel = lazy(() =>
    import('./post-channel-panel').then(module => ({ default: module.PostChannelPanel }))
)

export function ExistingPostPage(props: {
    readonly initialData: ExistingPostData
    readonly activePublicationId?: string
    readonly backToCalendar?: { readonly date?: string; readonly view?: PublicationCalendarView }
    readonly queryError?: unknown
    readonly configuredEditor?: boolean
}) {
    const { project } = useProjectDashboard()
    const lifecycle = useProjectLifecycle(project.id)
    if (!lifecycle.data) return null
    return <ExistingPostEditor {...props} archived={lifecycle.data.state !== 'active'} />
}

function ExistingPostEditor({
    initialData,
    activePublicationId,
    backToCalendar,
    queryError,
    configuredEditor = true,
    archived,
}: {
    readonly initialData: ExistingPostData
    readonly activePublicationId?: string
    readonly backToCalendar?: { readonly date?: string; readonly view?: PublicationCalendarView }
    readonly queryError?: unknown
    readonly configuredEditor?: boolean
    readonly archived: boolean
}) {
    const { locale } = useLanguage()
    const { project, channels, connections } = useProjectDashboard()
    const access = usePostEditorAccess(project.id)
    const readOnly = access.role === 'viewer' || archived
    const userId = useDashboardUserId()
    const navigate = useNavigate()
    const session = useExistingPostComposition({
        initialData,
        activePublicationId,
        userId,
        projectId: project.id,
        timeZone: project.timeZone,
        readOnly,
        accessStatus: access.status,
        accessEpoch: access.epoch,
        getAccessEpoch: access.getAccessEpoch,
        onAccessRefused: access.onAccessRefused,
        onAccessReconciled: access.onAccessReconciled,
    })
    const { composition, data } = session
    const [mediaPending, setMediaPending] = useState(false)
    const activeEditor = data.editors.find(
        editor => editor.publication.id === composition.activeContentScopeId
    )
    const previewEditor = activeEditor ?? data.editors[0]
    const previewContent = previewEditor
        ? compositionChannelContent(composition, previewEditor)
        : null
    const activeTarget = composition.activeContentTarget
    const source = compositionSource(composition, data.post.sourceContent)
    const ownSource =
        activeEditor && previewContent
            ? postFromChannelVersion(
                  activeTarget?.locked
                      ? (activeEditor.selectedTargetProfile ?? activeEditor.profile).profile
                      : activeEditor.profile.profile,
                  previewContent,
                  source
              )
            : source
    function changeTarget(content: Record<string, unknown>) {
        if (!activeEditor || activeTarget?.locked || access.status !== 'confirmed' || readOnly)
            return
        composition.setTargetDocument(
            activeEditor.publication.id,
            content,
            getTargetPreviewBody(activeEditor.profile.profile, content),
            !channelVersionFollowsSource(activeEditor.profile.profile, source, content)
        )
    }
    const surfaceComposition = {
        ...composition,
        postTitle: ownSource.headline ?? '',
        sourceMedia: [...ownSource.media],
        onPostTitleChange: activeEditor
            ? (value: SetStateAction<string>) => {
                  const next = typeof value === 'function' ? value(ownSource.headline ?? '') : value
                  const { headline: _headline, ...rest } = ownSource
                  changeTarget(
                      applyPostToChannel(
                          activeEditor.profile.profile,
                          { ...rest, ...(next ? { headline: next } : {}) },
                          previewContent!
                      ) ?? previewContent!
                  )
              }
            : composition.onPostTitleChange,
        onSourceMediaChange: activeEditor
            ? (value: SetStateAction<MediaSelection[]>) => {
                  const next = typeof value === 'function' ? value([...ownSource.media]) : value
                  changeTarget(
                      applyPostToChannel(
                          activeEditor.profile.profile,
                          { ...ownSource, media: next },
                          previewContent!
                      ) ?? previewContent!
                  )
              }
            : composition.onSourceMediaChange,
    }
    const blocked = readOnly || access.status !== 'confirmed'
    const staleCount = countStaleChannelVersions(
        data.publications,
        channels,
        data.post.sourceRevision
    )
    const recoveryChoice = session.recoveryChoice
    const recoveryInputs = recoveryChoice
        ? data.editors
              .filter(
                  editor =>
                      !session.recoveryCandidate?.publicationId ||
                      editor.publication.id === session.recoveryCandidate.publicationId
              )
              .map(editor => ({
                  editor,
                  localSource: compositionSource(recoveryChoice, data.post.sourceContent),
                  localTarget: compositionChannelContent(recoveryChoice, editor),
                  localSchedule:
                      recoveryChoice.publicationTargets.find(
                          target => target.id === editor.publication.id
                      )?.scheduledAt ?? '',
                  savedSchedule: toDateTimeLocal(editor.publication.scheduledAt, project.timeZone),
              }))
        : []
    const comparing = recoveryChoice !== null || session.saveState === 'conflict'
    // The comparisons show media items by id; load the ones the saved and local versions use.
    const comparisonMedia = useMediaReferences(
        project.id,
        comparing
            ? [
                  ...data.post.sourceContent.media,
                  ...data.editors.flatMap(editor => [
                      ...editor.draft.baseSourceContent.media,
                      ...getTargetMediaSelections(editor.profile.profile, editor.draft.content),
                  ]),
                  ...recoveryInputs.flatMap(input => [
                      ...input.localSource.media,
                      ...(input.localTarget
                          ? getTargetMediaSelections(
                                input.editor.profile.profile,
                                input.localTarget
                            )
                          : []),
                  ]),
              ].map(item => item.assetId)
            : [],
        comparing
    )

    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                const button = document.querySelector<HTMLButtonElement>('[data-post-save]')
                if (button && !button.disabled) {
                    event.preventDefault()
                    button.click()
                }
            }
        }
        window.addEventListener('keydown', keydown)
        return () => window.removeEventListener('keydown', keydown)
    }, [])
    useEffect(() => {
        if (queryError instanceof ApiError && [403, 404].includes(queryError.status))
            access.onAccessRefused()
    }, [queryError, access.onAccessRefused])
    // Without confirmed access there is nothing to save here and the local work stays in its
    // recovery copy, so leaving is never blocked (the denial page has no dialog to answer).
    const leaveGuarded =
        access.status === 'confirmed' && (session.dirty || session.scheduleDirty || mediaPending)
    // The blocker may keep its first callback; read the current guard through a ref.
    const leaveGuardedRef = useRef(leaveGuarded)
    leaveGuardedRef.current = leaveGuarded
    const blocker = useBlocker({
        shouldBlockFn: ({ next }) =>
            leaveGuardedRef.current &&
            !data.editors.some(editor =>
                next.pathname.endsWith(`/publications/${editor.publication.id}`)
            ),
        enableBeforeUnload: leaveGuarded,
        withResolver: true,
    })
    const select = (id: string) => {
        composition.selectContentScope(id)
        if (activePublicationId && id !== 'shared')
            void navigate({
                to: '/dashboard/projects/$projectId/publications/$publicationId',
                params: { projectId: project.id, publicationId: id },
                search: backToCalendar ? { ...backToCalendar, from: 'calendar' } : undefined,
                replace: true,
            })
    }
    if (access.status === 'denied')
        return <main className="px-4 py-8 sm:px-6 lg:px-8">{access.notice}</main>
    const pendingApply = data.editors.some(
        editor =>
            !composition.publicationTargets.find(target => target.id === editor.publication.id)
                ?.locked && channelHasPendingChanges(editor)
    )
    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {access.notice}
            {session.recoveryChoice ? (
                <Dialog open onOpenChange={() => {}}>
                    <DialogContent
                        showCloseButton={false}
                        data-publication-recovery-decision
                        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
                        <DialogTitle>{m.editor_recovery_choice_title()}</DialogTitle>
                        <DialogDescription>
                            {m.editor_recovery_choice_description()}
                        </DialogDescription>
                        {session.recoveryCandidate &&
                        !recoveryMatchesProfiles(session.recoveryCandidate, data.editors) ? (
                            <p role="alert">{m.profile_adoption_recovery_mismatch()}</p>
                        ) : null}
                        {recoveryInputs[0] &&
                        recoveryComparisonChanges(recoveryInputs[0]).source ? (
                            <div>
                                <h2 className="mt-4 text-sm font-medium">
                                    {m.publication_new_common_tab()}
                                </h2>
                                <PublicationRecoveryComparison
                                    {...recoveryInputs[0]}
                                    parts="source"
                                    projectId={project.id}
                                    media={comparisonMedia}
                                />
                            </div>
                        ) : null}
                        {recoveryInputs
                            .filter(input => {
                                const changes = recoveryComparisonChanges(input)
                                return changes.target || changes.schedule
                            })
                            .map(input => (
                                <div key={input.editor.publication.id}>
                                    <h2 className="mt-4 text-sm font-medium">
                                        {input.editor.channel.name}
                                    </h2>
                                    <PublicationRecoveryComparison
                                        {...input}
                                        parts="channel"
                                        projectId={project.id}
                                        media={comparisonMedia}
                                    />
                                </div>
                            ))}
                        <DialogFooter>
                            <Button
                                variant="secondary"
                                disabled={blocked}
                                onClick={() => session.chooseRecovery(false)}>
                                {m.editor_discard_recovery()}
                            </Button>
                            <Button
                                disabled={
                                    blocked ||
                                    (!!session.recoveryCandidate &&
                                        !recoveryMatchesProfiles(
                                            session.recoveryCandidate,
                                            data.editors
                                        ))
                                }
                                onClick={() => session.chooseRecovery(true)}>
                                {m.editor_restore_recovery()}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
            <Dialog
                open={blocker.status === 'blocked'}
                onOpenChange={open => {
                    if (!open && blocker.status === 'blocked') blocker.reset()
                }}>
                <DialogContent>
                    <DialogTitle>{m.post_source_leave()}</DialogTitle>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => blocker.status === 'blocked' && blocker.reset()}>
                            {m.common_cancel()}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => blocker.status === 'blocked' && blocker.proceed()}>
                            {m.publication_new_recovery_discard()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <div inert={session.recoveryChoice !== null}>
                <DashboardPageHeader
                    title={
                        data.post.title ||
                        shortExcerpt(composition.postContent || composition.postTitle) ||
                        m.publication_untitled()
                    }
                    action={
                        <PublicationEditorSaveIndicator
                            state={session.saveState}
                            pendingApply={pendingApply || session.dirty || session.scheduleDirty}
                        />
                    }
                    back={
                        <Link
                            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                            to={
                                backToCalendar
                                    ? '/dashboard/projects/$projectId/overview'
                                    : '/dashboard/projects/$projectId/queue'
                            }
                            params={{ projectId: project.id }}
                            search={
                                backToCalendar ?? {
                                    filter: undefined,
                                    sort: undefined,
                                    tagIds: undefined,
                                }
                            }>
                            <AltArrowLeftIcon aria-hidden="true" />
                            {backToCalendar
                                ? m.editor_back_to_calendar()
                                : m.editor_back_to_queue()}
                        </Link>
                    }
                />
                {/* A background update is told after the work it updated, never above it.
                    A conflict is told once, by the card below with its choices. */}
                {session.passive || session.saveState === 'conflict' ? null : (
                    <PublicationEditorStatus
                        message={session.message}
                        passive={session.passive}
                        saveState={session.saveState}
                        onReviewConflict={() => void session.reload()}
                    />
                )}
                {!readOnly ? (
                    <PostSourceReview
                        projectId={project.id}
                        postId={data.post.id}
                        staleCount={staleCount}
                        accessEpoch={access.epoch}
                        // The refresh after each updated channel must not stop the review
                        // half way; every update is checked against its expected revision.
                        disabled={blocked || session.dirty}
                        onApplied={() => void session.reload()}
                    />
                ) : null}
                {session.saveState === 'conflict' && (activeEditor ?? data.editors[0]) ? (
                    <PublicationEditorSidebar
                        editor={(activeEditor ?? data.editors[0])!}
                        projectId={project.id}
                        media={comparisonMedia}
                        sourceConflict={session.sourceConflict}
                        saveState={session.saveState}
                        isRebasing={session.saving}
                        recoveryAvailable={true}
                        hasLocalChanges={session.dirty}
                        onRebase={() => void session.rebase()}
                        onReload={() => void session.reload()}
                        onRestore={() => void session.reload(true)}
                        postLevel
                    />
                ) : null}
                <PostComposer
                    configuredEditor={configuredEditor}
                    composition={surfaceComposition}
                    headlineVisible={(activeEditor ? [activeEditor] : data.editors).some(editor =>
                        getTargetEditorFields(editor.profile.profile).some(
                            field => field.semantic === 'headline'
                        )
                    )}
                    preview={
                        previewEditor && previewContent ? (
                            <PostChannelPreview
                                editor={previewEditor}
                                content={previewContent}
                                locked={
                                    composition.publicationTargets.find(
                                        target => target.id === previewEditor.publication.id
                                    )?.locked === true
                                }
                            />
                        ) : null
                    }
                    channelTitle={target => {
                        if (!activeEditor || !previewContent) return null
                        const fields = getTargetEditorFields(activeEditor.profile.profile)
                        if (!fields.some(field => field.semantic === 'headline')) return null
                        return (
                            <div className="mb-4" data-channel-title>
                                <PublicationTargetEditor
                                    profile={activeEditor.profile.profile}
                                    target={previewContent}
                                    validationIssues={activeEditor.draft.validationIssues}
                                    omitPaths={fields
                                        .filter(field => field.semantic !== 'headline')
                                        .map(field => field.path)}
                                    onTargetChange={changeTarget}
                                    disabled={blocked || target.locked === true}
                                    readOnly={blocked || target.locked === true}
                                    compact
                                />
                            </div>
                        )
                    }}
                    channelStatus={target =>
                        activeEditor ? (
                            <PostChannelPanel
                                part="status"
                                key={`status:${target.id}`}
                                editor={activeEditor}
                                backToCalendar={backToCalendar}
                                content={previewContent!}
                                locked={target.locked === true}
                                blocked={blocked}
                                pendingChanges={
                                    session.dirty ||
                                    mediaPending ||
                                    session.saving ||
                                    session.applying
                                }
                                onContentChange={changeTarget}
                                onRefresh={() => session.reload()}
                                onAccessRefused={access.onAccessRefused}
                                getAccessEpoch={access.getAccessEpoch}
                                timeZone={project.timeZone}
                            />
                        ) : null
                    }
                    channelPanel={target =>
                        activeEditor ? (
                            <Suspense fallback={<p role="status">{m.common_loading()}</p>}>
                                {session.applyResults[target.id] ? (
                                    <div
                                        data-channel-apply-result={
                                            session.applyResults[target.id]!.state
                                        }
                                        className="mt-4 flex flex-wrap items-center gap-3 text-sm"
                                        role="status">
                                        <p>
                                            {session.applyResults[target.id]!.message ??
                                                m.editor_saved()}
                                        </p>
                                        {session.applyResults[target.id]!.state !== 'applied' ? (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={blocked || session.applying}
                                                onClick={() =>
                                                    session.applyResults[target.id]!.state ===
                                                    'unconfirmed'
                                                        ? void session.checkApplication(target.id)
                                                        : void session.save(target.id)
                                                }>
                                                {session.applyResults[target.id]!.state ===
                                                'unconfirmed'
                                                    ? m.editor_check_server()
                                                    : m.common_retry()}
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}
                                <PostChannelPanel
                                    part="details"
                                    key={target.id}
                                    editor={activeEditor}
                                    backToCalendar={backToCalendar}
                                    content={previewContent!}
                                    locked={target.locked === true}
                                    blocked={blocked}
                                    pendingChanges={
                                        session.dirty ||
                                        mediaPending ||
                                        session.saving ||
                                        session.applying
                                    }
                                    onContentChange={changeTarget}
                                    onRefresh={() => session.reload()}
                                    onAccessRefused={access.onAccessRefused}
                                    getAccessEpoch={access.getAccessEpoch}
                                    timeZone={project.timeZone}
                                />
                            </Suspense>
                        ) : null
                    }
                    footer={
                        !readOnly ? (
                            <div className="flex flex-wrap items-center justify-end gap-3">
                                {pendingApply || session.dirty || session.scheduleDirty ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        data-publication-discard-action
                                        disabled={blocked || session.saving || session.applying}
                                        onClick={session.discard}>
                                        {m.editor_discard_changes()}
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    data-post-save
                                    data-publication-promotion-action
                                    disabled={
                                        blocked ||
                                        mediaPending ||
                                        session.applying ||
                                        session.saveState === 'conflict' ||
                                        session.sourceConflict ||
                                        // An application with an unknown result is checked
                                        // before anything else is applied.
                                        Object.values(session.applyResults).some(
                                            result => result?.state === 'unconfirmed'
                                        ) ||
                                        !(pendingApply || session.dirty || session.scheduleDirty)
                                    }
                                    aria-busy={session.applying}
                                    onClick={() => void session.save()}>
                                    {session.applying ? m.editor_saving() : m.common_save()}
                                </Button>
                            </div>
                        ) : null
                    }
                    project={project}
                    activeChannels={channels}
                    connections={connections}
                    pending={session.applying}
                    disabled={access.status !== 'confirmed'}
                    readOnly={readOnly}
                    mediaDisabled={readOnly || access.status !== 'confirmed'}
                    mediaReadOnly={readOnly}
                    onMediaPreparationChange={setMediaPending}
                    onError={() => false}
                    pickerTags={[]}
                    tags={
                        <ExistingPostTags
                            session={session}
                            blocked={blocked}
                            projectId={project.id}
                            getAccessEpoch={access.getAccessEpoch}
                        />
                    }
                    settings={null}
                    sharedPanel={
                        <details className="mt-4 rounded-lg border border-border px-3">
                            <summary className="cursor-pointer py-3 text-sm font-medium">
                                {m.editor_content_options()}
                            </summary>
                            <div className="grid gap-4 pb-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel htmlFor="source-format">
                                        {m.editor_source_format()}
                                    </FieldLabel>
                                    <Select
                                        items={{
                                            plain_text: m.editor_plain_text(),
                                            markdown: m.editor_markdown(),
                                        }}
                                        value={composition.sourceFormat ?? 'plain_text'}
                                        onValueChange={value =>
                                            composition.restoreComposition({
                                                ...composition,
                                                sourceFormat: value as 'plain_text' | 'markdown',
                                            })
                                        }>
                                        <SelectTrigger id="source-format" disabled={blocked}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="plain_text">
                                                {m.editor_plain_text()}
                                            </SelectItem>
                                            <SelectItem value="markdown">
                                                {m.editor_markdown()}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="source-language">
                                        {m.editor_source_language()}
                                    </FieldLabel>
                                    <LanguageCombobox
                                        id="source-language"
                                        value={composition.sourceLanguage ?? ''}
                                        onValueChange={value =>
                                            composition.restoreComposition({
                                                ...composition,
                                                sourceLanguage: value,
                                            })
                                        }
                                        disabled={blocked}
                                    />
                                </Field>
                            </div>
                        </details>
                    }

                    channelNavigation={
                        <ExistingPostChannels
                            session={session}
                            blocked={blocked}
                            getAccessEpoch={access.getAccessEpoch}
                            onAccessRefused={access.onAccessRefused}
                            onSelect={select}
                        />
                    }
                />
                {session.passive ? (
                    <PublicationEditorStatus
                        message={session.message}
                        passive={session.passive}
                        saveState={session.saveState}
                        onReviewConflict={() => void session.reload()}
                    />
                ) : null}
                {!activeEditor ? (
                    <section
                        className="mx-auto mt-6 min-w-0 max-w-6xl"
                        aria-label={m.post_destinations()}>
                        <h2 className="mb-3 text-sm font-medium">{m.post_destinations()}</h2>
                        {data.editors.map(editor => (
                            <div
                                key={editor.publication.id}
                                className="flex min-w-0 flex-wrap items-center gap-3 py-2">
                                <Link
                                    className={buttonVariants({
                                        variant: 'ghost',
                                        className: 'min-w-0',
                                    })}
                                    data-publication-edit-link="true"
                                    to="/dashboard/projects/$projectId/publications/$publicationId"
                                    params={{
                                        projectId: project.id,
                                        publicationId: editor.publication.id,
                                    }}
                                    search={
                                        backToCalendar
                                            ? { ...backToCalendar, from: 'calendar' as const }
                                            : undefined
                                    }>
                                    <ChannelAvatar channel={editor.channel} size="sm" />
                                    <span className="truncate">{editor.channel.name}</span>
                                </Link>
                                <PublicationStatus state={editor.publication.state} />
                                <span className="text-xs text-muted-foreground">
                                    {formatSchedule(
                                        editor.publication.scheduledAt,
                                        project.timeZone,
                                        locale
                                    )}
                                </span>
                                {editor.publication.errorMessage ? (
                                    <p data-publication-error className="text-sm text-state-failed">
                                        {editor.publication.errorMessage}
                                    </p>
                                ) : null}
                                {editor.publication.externalUrl ? (
                                    <a
                                        className="text-sm text-link"
                                        href={editor.publication.externalUrl}
                                        target="_blank"
                                        rel="noreferrer">
                                        {m.common_view()}
                                    </a>
                                ) : null}
                            </div>
                        ))}
                    </section>
                ) : null}
            </div>
        </main>
    )
}
