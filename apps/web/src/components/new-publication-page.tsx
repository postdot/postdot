import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { Textarea } from '@herald/ui/components/textarea'
import {
    X_MAX_WEIGHTED_POST_LENGTH,
    parseXPostText,
    type XWeightedTextResult,
} from '@herald/x/text'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { CalendarAddIcon } from '@solar-icons/react/linear/calendar-add'
import { FileTextIcon } from '@solar-icons/react/linear/file-text'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { DashboardFormField } from '@/components/dashboard-form-field'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import {
    PublicationChannelSettings,
    PublicationChannelTabs,
    publicationSharedTabId,
} from '@/components/publication-target-list'
import { XWeightedTextCount } from '@/components/x-weighted-text-count'
import { api, formatApiError, type MediaReference, type PublicationComposerDraft } from '@/lib/api'
import { type PublicationCreationMode, useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { calendarDateTimeLocal, type DeliveryMode } from '@/lib/publication-authoring'
import {
    clearPublicationRecovery,
    hasRecoverablePublicationContent,
    readPublicationRecovery,
    writePublicationRecovery,
    type PublicationComposerDraftContent,
    type PublicationRecoveryState,
} from '@/lib/publication-recovery'
import * as m from '@/paraglide/messages.js'

export function NewPublicationPage({
    calendarDate,
    calendarTime,
}: {
    readonly calendarDate?: string
    readonly calendarTime?: string
}) {
    useLanguage()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/publications/new' })
    const {
        activeChannels,
        connections,
        error,
        onCreatePost,
        onPostContentChange,
        onPostTitleChange,
        onPublicationTargetsChange,
        onSourceMediaChange,
        pending,
        postContent,
        postTitle,
        project,
        projectTags,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
        onPublicationTagIdsChange,
    } = useProjectDashboard()
    const appliedCalendarSlot = useRef<string | undefined>(undefined)
    const [defaultDeliveryMode, setDefaultDeliveryMode] = useState<DeliveryMode>(
        () => publicationTargets[0]?.deliveryMode ?? 'manual'
    )
    const [defaultScheduledAt, setDefaultScheduledAt] = useState(
        () => publicationTargets[0]?.scheduledAt ?? ''
    )
    const [customizedTargetIds, setCustomizedTargetIds] = useState<Set<string>>(() => new Set())
    const [customizedContentTargetIds, setCustomizedContentTargetIds] = useState<Set<string>>(
        () =>
            new Set(
                publicationTargets
                    .filter(target => target.content.trim() !== '')
                    .map(target => target.id)
            )
    )
    const [activePublicationTabId, setActivePublicationTabId] = useState(
        () =>
            publicationTargets.find(target => target.channelId !== '')?.id ?? publicationSharedTabId
    )
    const [availableMedia, setAvailableMedia] = useState<MediaReference[]>([])
    const hasCurrentComposerContent = hasRecoverablePublicationContent({
        postContent,
        publicationTargets,
        sourceMedia,
    })
    const [recovery, setRecovery] = useState<PublicationRecoveryState | null>(() =>
        hasCurrentComposerContent ? null : readPublicationRecovery(project.id)
    )
    const [serverDraft, setServerDraft] = useState<PublicationComposerDraft | null>(null)
    const [serverDraftReady, setServerDraftReady] = useState(false)
    const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
        'idle'
    )
    const [autosaveError, setAutosaveError] = useState<string | null>(null)
    const recoveryPromptOpen = useRef(recovery !== null)
    const currentComposerHasContent = useRef(hasCurrentComposerContent)
    const serverDraftRef = useRef<PublicationComposerDraft | null>(null)
    const autosaveQueue = useRef(Promise.resolve())
    const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const previousTargetIds = useRef(new Set(publicationTargets.map(target => target.id)))
    const activeTarget =
        activePublicationTabId === publicationSharedTabId
            ? undefined
            : publicationTargets.find(target => target.id === activePublicationTabId)
    const activePreviewTarget = activeTarget ?? publicationTargets[0]
    const activePreviewChannel = activeChannels.find(
        channel => channel.id === activePreviewTarget?.channelId
    )
    const activeTargetUsesSharedContent =
        activeTarget === undefined || !customizedContentTargetIds.has(activeTarget.id)
    const usesXTextRules = activePreviewChannel?.profileId === 'x'
    const activeText =
        activeTarget !== undefined && !activeTargetUsesSharedContent
            ? activeTarget.content
            : postContent
    const activeTextValidation = usesXTextRules ? parseXPostText(activeText) : null
    const activeTextInvalid =
        activeTextValidation !== null && activeText.trim().length > 0 && !activeTextValidation.valid
    const previewMedia = sourceMedia
        .map(selection => availableMedia.find(asset => asset.asset.id === selection.assetId))
        .filter((asset): asset is MediaReference => asset !== undefined)

    currentComposerHasContent.current = hasCurrentComposerContent
    serverDraftRef.current = serverDraft

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        await autosaveQueue.current.catch(() => undefined)

        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const mode: PublicationCreationMode =
            submitter instanceof HTMLButtonElement && submitter.value === 'draft'
                ? 'draft'
                : 'schedule'
        const publications = await onCreatePost(event, mode)
        if (publications !== null) {
            clearPublicationRecovery(project.id)
            await discardServerDraft()
            recoveryPromptOpen.current = false
            setRecovery(null)
        }
        const publication = publications?.[0]
        if (mode !== 'draft' || publication === undefined) return

        await navigate({
            to: '/dashboard/projects/$projectId/publications/$publicationId',
            params: { projectId: project.id, publicationId: publication.id },
        })
    }

    function restoreRecovery() {
        if (recovery === null) return

        onPostTitleChange(recovery.postTitle)
        onPostContentChange(recovery.postContent)
        onSourceMediaChange(recovery.sourceMedia)
        onPublicationTargetsChange(recovery.publicationTargets)
        onPublicationTagIdsChange(recovery.publicationTagIds)
        setDefaultDeliveryMode(recovery.defaultDeliveryMode)
        setDefaultScheduledAt(recovery.defaultScheduledAt)
        setCustomizedTargetIds(new Set(recovery.customizedTargetIds))
        setCustomizedContentTargetIds(new Set(recovery.customizedContentTargetIds))
        setActivePublicationTabId(recovery.activePublicationTabId)
        clearPublicationRecovery(project.id)
        recoveryPromptOpen.current = false
        setRecovery(null)
    }

    async function discardRecovery() {
        clearPublicationRecovery(project.id)
        await discardServerDraft()
        recoveryPromptOpen.current = false
        setRecovery(null)
    }

    async function discardServerDraft() {
        if (serverDraftRef.current === null) return

        try {
            await api.deletePublicationComposerDraft(project.id)
            serverDraftRef.current = null
            setServerDraft(null)
            setAutosaveState('idle')
            setAutosaveError(null)
        } catch (caughtError) {
            setAutosaveState('error')
            setAutosaveError(formatApiError(caughtError))
        }
    }

    function composerDraftContent(): PublicationComposerDraftContent {
        return {
            activePublicationTabId,
            customizedContentTargetIds: [...customizedContentTargetIds],
            customizedTargetIds: [...customizedTargetIds],
            defaultDeliveryMode,
            defaultScheduledAt,
            postContent,
            postTitle,
            publicationTagIds: [...publicationTagIds],
            publicationTargets: publicationTargets.map(target => ({ ...target })),
            sourceMedia: sourceMedia.map(selection => ({ ...selection })),
        }
    }

    const autosaveStatus =
        autosaveState === 'saving'
            ? m.publication_new_autosave_saving()
            : autosaveState === 'saved'
              ? m.publication_new_autosave_saved()
              : autosaveState === 'error'
                ? m.publication_new_autosave_unavailable()
                : null

    useEffect(() => {
        let cancelled = false

        void api
            .getPublicationComposerDraft(project.id)
            .then(({ draft }) => {
                if (cancelled) return
                serverDraftRef.current = draft
                setServerDraft(draft)
                setServerDraftReady(true)

                if (currentComposerHasContent.current || draft === null) return

                const localRecovery = readPublicationRecovery(project.id)
                const serverRecovery: PublicationRecoveryState = {
                    ...draft.content,
                    savedAt: draft.updatedAt,
                    version: 1,
                }
                if (localRecovery === null || draft.updatedAt >= localRecovery.savedAt) {
                    recoveryPromptOpen.current = true
                    setRecovery(serverRecovery)
                }
            })
            .catch(caughtError => {
                if (cancelled) return
                setServerDraftReady(true)
                setAutosaveState('error')
                setAutosaveError(formatApiError(caughtError))
            })

        return () => {
            cancelled = true
        }
    }, [project.id])

    useEffect(() => {
        if (!serverDraftReady || recoveryPromptOpen.current) return

        if (!hasCurrentComposerContent) {
            if (serverDraftRef.current === null) return
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(() => discardServerDraft())
            return
        }

        if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
        const content = composerDraftContent()
        autosaveTimer.current = setTimeout(() => {
            autosaveQueue.current = autosaveQueue.current
                .catch(() => undefined)
                .then(async () => {
                    setAutosaveState('saving')
                    setAutosaveError(null)
                    try {
                        const response = await api.savePublicationComposerDraft(
                            project.id,
                            serverDraftRef.current?.revision ?? 0,
                            content
                        )
                        serverDraftRef.current = response.draft
                        setServerDraft(response.draft)
                        setAutosaveState('saved')
                    } catch (caughtError) {
                        setAutosaveState('error')
                        setAutosaveError(formatApiError(caughtError))
                    }
                })
        }, 900)

        return () => {
            if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
            autosaveTimer.current = undefined
        }
    }, [
        activePublicationTabId,
        customizedContentTargetIds,
        customizedTargetIds,
        defaultDeliveryMode,
        defaultScheduledAt,
        hasCurrentComposerContent,
        postContent,
        postTitle,
        project.id,
        publicationTagIds,
        publicationTargets,
        recovery,
        serverDraftReady,
        sourceMedia,
    ])

    useEffect(() => {
        if (recoveryPromptOpen.current) return
        writePublicationRecovery(project.id, {
            activePublicationTabId,
            customizedContentTargetIds,
            customizedTargetIds,
            defaultDeliveryMode,
            defaultScheduledAt,
            postContent,
            postTitle,
            publicationTagIds,
            publicationTargets,
            sourceMedia,
        })
    }, [
        activePublicationTabId,
        customizedContentTargetIds,
        customizedTargetIds,
        defaultDeliveryMode,
        defaultScheduledAt,
        postContent,
        postTitle,
        project.id,
        publicationTagIds,
        publicationTargets,
        sourceMedia,
    ])

    useEffect(() => {
        const nextTargetIds = new Set(publicationTargets.map(target => target.id))
        const preservedTarget = [...previousTargetIds.current].some(id => nextTargetIds.has(id))
        const firstTarget = publicationTargets[0]

        if (!preservedTarget && firstTarget !== undefined) {
            setDefaultDeliveryMode(firstTarget.deliveryMode)
            setDefaultScheduledAt(firstTarget.scheduledAt)
            setCustomizedTargetIds(new Set())
        }
        previousTargetIds.current = nextTargetIds
    }, [publicationTargets])

    useEffect(() => {
        const firstTarget = publicationTargets[0]
        const firstActiveChannel = activeChannels[0]
        if (
            publicationTargets.length !== 1 ||
            firstTarget === undefined ||
            firstTarget.channelId !== '' ||
            firstActiveChannel === undefined
        ) {
            return
        }

        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                target.id === firstTarget.id
                    ? { ...target, channelId: firstActiveChannel.id }
                    : target
            )
        )
        setActivePublicationTabId(firstTarget.id)
    }, [activeChannels, onPublicationTargetsChange, publicationTargets])

    useEffect(() => {
        if (activePublicationTabId === publicationSharedTabId) return
        if (
            publicationTargets.some(
                target => target.id === activePublicationTabId && target.channelId !== ''
            )
        ) {
            return
        }
        setActivePublicationTabId(
            publicationTargets.find(target => target.channelId !== '')?.id ?? publicationSharedTabId
        )
    }, [activePublicationTabId, publicationTargets])

    useEffect(() => {
        if (
            calendarDate === undefined ||
            appliedCalendarSlot.current === `${calendarDate}:${calendarTime ?? ''}` ||
            publicationTargets.length === 0
        ) {
            return
        }

        const scheduledAt = calendarDateTimeLocal(calendarDate, calendarTime)
        if (scheduledAt === undefined) return

        appliedCalendarSlot.current = `${calendarDate}:${calendarTime ?? ''}`
        setDefaultScheduledAt(scheduledAt)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, scheduledAt }
            )
        )
    }, [
        calendarDate,
        calendarTime,
        customizedTargetIds,
        onPublicationTargetsChange,
        publicationTargets.length,
    ])

    function handleDefaultDeliveryModeChange(deliveryMode: DeliveryMode) {
        setDefaultDeliveryMode(deliveryMode)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, deliveryMode }
            )
        )
    }

    function handleDefaultScheduledAtChange(scheduledAt: string) {
        setDefaultScheduledAt(scheduledAt)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, scheduledAt }
            )
        )
    }

    function handleTargetCustomizationChange(targetId: string, customized: boolean) {
        setCustomizedTargetIds(current => {
            const next = new Set(current)
            if (customized) next.add(targetId)
            else next.delete(targetId)
            return next
        })

        if (!customized) {
            onPublicationTargetsChange(currentTargets =>
                currentTargets.map(target =>
                    target.id === targetId
                        ? {
                              ...target,
                              deliveryMode: defaultDeliveryMode,
                              scheduledAt: defaultScheduledAt,
                          }
                        : target
                )
            )
        }
    }

    function updateTargetContent(targetId: string, content: string) {
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target => (target.id === targetId ? { ...target, content } : target))
        )
    }

    function customizeTargetContent(targetId: string) {
        setCustomizedContentTargetIds(current => {
            const next = new Set(current)
            next.add(targetId)
            return next
        })
        updateTargetContent(targetId, postContent)
    }

    function useSharedTargetContent(targetId: string) {
        setCustomizedContentTargetIds(current => {
            const next = new Set(current)
            next.delete(targetId)
            return next
        })
        updateTargetContent(targetId, '')
    }

    function removeTarget(targetId: string) {
        setCustomizedContentTargetIds(current => {
            const next = new Set(current)
            next.delete(targetId)
            return next
        })
        onPublicationTargetsChange(currentTargets =>
            currentTargets.filter(target => target.id !== targetId)
        )
    }

    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                        nativeButton={false}
                        render={
                            <Link
                                params={{ projectId: project.id }}
                                to="/dashboard/projects/$projectId/overview"
                            />
                        }
                        size="sm"
                        variant="ghost">
                        <AltArrowLeftIcon aria-hidden="true" />
                        {m.publication_new_back_overview()}
                    </Button>
                }
                title={m.publication_new_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            {recovery !== null ? (
                <Alert className="mb-4 rounded-md border-primary/25 bg-primary/5">
                    <AlertTitle>{m.publication_new_recovery_title()}</AlertTitle>
                    <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span>{m.publication_new_recovery_description()}</span>
                        <span className="flex shrink-0 items-center gap-2">
                            <Button
                                onClick={() => void discardRecovery()}
                                size="xs"
                                type="button"
                                variant="ghost">
                                {m.publication_new_recovery_discard()}
                            </Button>
                            <Button onClick={restoreRecovery} size="xs" type="button">
                                {m.publication_new_recovery_restore()}
                            </Button>
                        </span>
                    </AlertDescription>
                </Alert>
            ) : null}
            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.publication_new_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form onSubmit={event => void handleSubmit(event)}>
                <section data-new-publication-workspace="true">
                    <PublicationComposer
                        channelNavigation={
                            <PublicationChannelTabs
                                activeTargetId={activePublicationTabId}
                                channels={activeChannels}
                                connections={connections}
                                defaultDeliveryMode={defaultDeliveryMode}
                                defaultScheduledAt={defaultScheduledAt}
                                disabled={pending}
                                onActiveTargetChange={setActivePublicationTabId}
                                onChange={onPublicationTargetsChange}
                                onDefaultDeliveryModeChange={handleDefaultDeliveryModeChange}
                                projectId={project.id}
                                targets={publicationTargets}
                                timeZone={project.timeZone}
                            />
                        }
                        editor={
                            <div className="min-w-0">
                                {activePreviewChannel?.profileId === 'devto' ? (
                                    <DashboardFormField
                                        htmlFor="new-post-title"
                                        label={m.publication_new_post_title()}>
                                        <Input
                                            id="new-post-title"
                                            value={postTitle}
                                            onChange={event =>
                                                onPostTitleChange(event.target.value)
                                            }
                                            placeholder={m.publication_new_optional_source_title()}
                                        />
                                    </DashboardFormField>
                                ) : null}

                                <div
                                    data-new-publication-editor="true"
                                    className="overflow-hidden rounded-xl bg-surface-field shadow-surface focus-within:shadow-control">
                                    {activeTarget !== undefined &&
                                    !activeTargetUsesSharedContent ? (
                                        <PublicationChannelContentEditor
                                            content={activeTarget.content}
                                            disabled={pending}
                                            id={activeTarget.id}
                                            weightedLimit={
                                                usesXTextRules ? X_MAX_WEIGHTED_POST_LENGTH : null
                                            }
                                            onChange={content =>
                                                updateTargetContent(activeTarget.id, content)
                                            }
                                            onUseShared={() =>
                                                useSharedTargetContent(activeTarget.id)
                                            }
                                        />
                                    ) : (
                                        <div>
                                            {activeTarget !== undefined ? (
                                                <div className="flex justify-end px-3 pt-2">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="xs"
                                                        disabled={pending}
                                                        onClick={() =>
                                                            customizeTargetContent(activeTarget.id)
                                                        }>
                                                        {m.publication_new_customize_channel()}
                                                    </Button>
                                                </div>
                                            ) : null}
                                            <Textarea
                                                id="new-post-content"
                                                aria-label={m.publication_new_source_content()}
                                                aria-describedby={
                                                    usesXTextRules
                                                        ? 'new-post-content-weighted-count'
                                                        : undefined
                                                }
                                                aria-invalid={activeTextInvalid || undefined}
                                                value={postContent}
                                                disabled={pending}
                                                onChange={event =>
                                                    onPostContentChange(event.target.value)
                                                }
                                                placeholder={m.publication_new_source_placeholder()}
                                                rows={9}
                                                className="min-h-56 resize-y rounded-none border-0 bg-transparent p-4 text-base leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
                                            />
                                            {activeTextValidation !== null ? (
                                                <div className="px-4 pb-3">
                                                    <XWeightedTextCount
                                                        id="new-post-content-weighted-count"
                                                        invalid={activeTextInvalid}
                                                        result={activeTextValidation}
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    )}

                                    <MediaAttachmentPicker
                                        variant="publication-new-inline"
                                        projectId={project.id}
                                        value={sourceMedia}
                                        onChange={onSourceMediaChange}
                                        onAssetsChange={setAvailableMedia}
                                        disabled={pending}
                                    />
                                </div>

                                {projectTags.length > 0 ? (
                                    <div className="mt-5">
                                        <PublicationTagPicker
                                            ariaLabel={m.taxonomy_select_tags()}
                                            disabled={pending}
                                            emptyLabel={m.taxonomy_no_tags()}
                                            label={m.taxonomy_tags()}
                                            onChange={onPublicationTagIdsChange}
                                            selectedTagIds={publicationTagIds}
                                            selectedLabel={count =>
                                                m.taxonomy_selected_tags({ count })
                                            }
                                            tags={projectTags}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        }
                        footer={
                            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                <span
                                    aria-live="polite"
                                    className="min-h-4 text-xs text-muted-foreground"
                                    title={autosaveError ?? undefined}>
                                    {autosaveStatus}
                                </span>
                                <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                        name="publication-action"
                                        type="submit"
                                        value="draft"
                                        variant="ghost"
                                        disabled={pending || activeChannels.length === 0}>
                                        <FileTextIcon aria-hidden="true" />
                                        {m.publication_new_save_draft()}
                                    </Button>
                                    <Button
                                        name="publication-action"
                                        type="submit"
                                        value="schedule"
                                        disabled={pending || activeChannels.length === 0}>
                                        <CalendarAddIcon aria-hidden="true" />
                                        {publicationTargets.length === 1
                                            ? publicationTargets[0]?.deliveryMode === 'automatic'
                                                ? m.publication_new_schedule_automatic()
                                                : m.publication_new_schedule_manual()
                                            : m.publication_new_schedule_count({
                                                  count: publicationTargets.length,
                                              })}
                                    </Button>
                                </div>
                            </div>
                        }
                        preview={
                            activePreviewChannel !== undefined ? (
                                <PublicationDraftPreview
                                    channel={activePreviewChannel}
                                    media={previewMedia}
                                    postContent={postContent}
                                    postTitle={postTitle}
                                    targetContent={
                                        activeTargetUsesSharedContent
                                            ? undefined
                                            : activePreviewTarget?.content
                                    }
                                />
                            ) : undefined
                        }
                        settings={
                            <PublicationChannelSettings
                                activeTargetId={activePublicationTabId}
                                channels={activeChannels}
                                connections={connections}
                                customizedTargetIds={customizedTargetIds}
                                defaultDeliveryMode={defaultDeliveryMode}
                                defaultScheduledAt={defaultScheduledAt}
                                disabled={pending}
                                onActiveTargetChange={setActivePublicationTabId}
                                onDefaultDeliveryModeChange={handleDefaultDeliveryModeChange}
                                onDefaultScheduledAtChange={handleDefaultScheduledAtChange}
                                onChange={onPublicationTargetsChange}
                                onRemoveTarget={removeTarget}
                                onTargetCustomizationChange={handleTargetCustomizationChange}
                                projectId={project.id}
                                targets={publicationTargets}
                                timeZone={project.timeZone}
                            />
                        }
                    />
                </section>
            </form>
        </main>
    )
}

function PublicationChannelContentEditor({
    content,
    disabled,
    id,
    weightedLimit,
    onChange,
    onUseShared,
}: {
    readonly content: string
    readonly disabled: boolean
    readonly id: string
    readonly weightedLimit: number | null
    readonly onChange: (content: string) => void
    readonly onUseShared: () => void
}) {
    const weightedText: XWeightedTextResult | null =
        weightedLimit === null ? null : parseXPostText(content)
    const weightedTextInvalid =
        weightedText !== null && content.trim().length > 0 && !weightedText.valid

    return (
        <section data-publication-channel-content="true" className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={disabled}
                    onClick={onUseShared}>
                    {m.publication_new_use_source()}
                </Button>
            </div>

            <Textarea
                aria-label={m.publication_new_channel_copy()}
                id={`publication-target-${id}-content`}
                value={content}
                disabled={disabled}
                onChange={event => onChange(event.target.value)}
                aria-describedby={
                    weightedLimit === null ? undefined : `publication-target-${id}-weighted-count`
                }
                aria-invalid={weightedTextInvalid || undefined}
                placeholder={m.publication_new_optional_override()}
                rows={9}
                className="min-h-56 resize-y rounded-none border-0 bg-transparent text-base leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {weightedText !== null ? (
                <div className="px-3 pb-3">
                    <XWeightedTextCount
                        id={`publication-target-${id}-weighted-count`}
                        invalid={weightedTextInvalid}
                        result={weightedText}
                    />
                </div>
            ) : null}
        </section>
    )
}
