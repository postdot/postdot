import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { Textarea } from '@herald/ui/components/textarea'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { useEffect, useRef, useState } from 'react'

import { DashboardFormField } from '@/components/dashboard-form-field'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import { PublicationTagPicker } from '@/components/publication-tag-picker'
import {
    PublicationChannelSettings,
    PublicationChannelTabs,
    publicationSharedTabId,
} from '@/components/publication-target-list'
import type { MediaReference } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { calendarDateTimeLocal, type DeliveryMode } from '@/lib/publication-authoring'
import * as m from '@/paraglide/messages.js'

export function NewPublicationPage({
    calendarDate,
    calendarTime,
}: {
    readonly calendarDate?: string
    readonly calendarTime?: string
}) {
    useLanguage()
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
    const previewMedia = sourceMedia
        .map(selection => availableMedia.find(asset => asset.asset.id === selection.assetId))
        .filter((asset): asset is MediaReference => asset !== undefined)

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
            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.publication_new_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form onSubmit={onCreatePost}>
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
                                                value={postContent}
                                                disabled={pending}
                                                onChange={event =>
                                                    onPostContentChange(event.target.value)
                                                }
                                                placeholder={m.publication_new_source_placeholder()}
                                                rows={9}
                                                className="min-h-56 resize-y rounded-none border-0 bg-transparent p-4 text-base leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
                                            />
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
                            <Button type="submit" disabled={pending || activeChannels.length === 0}>
                                <CalendarAddIcon aria-hidden="true" />
                                {publicationTargets.length === 1
                                    ? publicationTargets[0]?.deliveryMode === 'automatic'
                                        ? m.publication_new_schedule_automatic()
                                        : m.publication_new_schedule_manual()
                                    : m.publication_new_schedule_count({
                                          count: publicationTargets.length,
                                      })}
                            </Button>
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
    onChange,
    onUseShared,
}: {
    readonly content: string
    readonly disabled: boolean
    readonly id: string
    readonly onChange: (content: string) => void
    readonly onUseShared: () => void
}) {
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
                placeholder={m.publication_new_optional_override()}
                rows={9}
                className="min-h-56 resize-y rounded-none border-0 bg-transparent text-base leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
        </section>
    )
}
