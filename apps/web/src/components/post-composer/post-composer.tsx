import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { Input } from '@postdot/ui/components/input'
import { cn } from '@postdot/ui/lib/utils'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { CalendarMinimalisticIcon } from '@solar-icons/react/linear/calendar-minimalistic'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { useQuery } from '@tanstack/react-query'
import {
    lazy,
    Suspense,
    useEffect,
    useMemo,
    useState,
    type ComponentProps,
    type ReactNode,
} from 'react'

import { ActionTooltip } from '@/components/action-tooltip'
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
import { PublicationTextCount } from '@/components/publication-text-count'
import { PublicationTextEditor } from '@/components/publication-text-editor'
import { api, type ChannelListItem, type MediaReference, type PublisherConnection } from '@/lib/api'
import { countComposerText, getComposerTextFields } from '@/lib/composer-text-constraints'
import { formatCivilSchedule } from '@/lib/date-time'
import { formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import { getNativeEditorProfile } from '@/lib/native-presentation'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

import type { PostComposition, PostCompositionTarget } from './use-post-composition'

const ConfiguredPublicationEditor = lazy(() =>
    import('@/components/configured-publication-editor').then(module => ({
        default: module.ConfiguredPublicationEditor,
    }))
)

type TagPickerProps = ComponentProps<typeof PublicationTagPicker>
export interface PostComposerProps {
    readonly composition: PostComposition
    readonly project: { readonly id: string; readonly timeZone: string }
    readonly activeChannels: readonly ChannelListItem[]
    readonly connections: readonly PublisherConnection[]
    readonly pending: boolean
    readonly disabled?: boolean
    readonly configuredEditor?: boolean
    readonly readOnly?: boolean
    readonly onRemoveTarget?: (targetId: string) => void
    readonly createChannel?: ReactNode
    readonly footer?: ReactNode
    readonly headlineVisible?: boolean
    readonly channelNavigation?: ReactNode
    readonly preview?: ReactNode
    readonly settings?: ReactNode
    readonly tags?: ReactNode
    readonly sharedPanel?: ReactNode
    readonly channelPanel?: (target: PostCompositionTarget) => ReactNode
    /** The active channel's state strip, above the title and editor it acts on. */
    readonly channelStatus?: (target: PostCompositionTarget) => ReactNode
    readonly pickerTags: TagPickerProps['tags']
    readonly onCreateProjectTag?: TagPickerProps['onCreateTag']
    readonly mediaDisabled: boolean
    readonly mediaReadOnly: boolean
    readonly onMediaPreparationChange: (pending: boolean) => void
    readonly onError: (error: unknown) => boolean
}

/** Shared writing surface. Persistence, recovery and final actions belong to its caller. */
export function PostComposer({
    composition,
    project,
    activeChannels,
    connections,
    pending,
    disabled = false,
    configuredEditor = true,
    readOnly = false,
    onRemoveTarget,
    createChannel,
    footer,
    channelPanel,
    channelStatus,
    channelNavigation,
    headlineVisible,
    preview,
    settings,
    tags,
    sharedPanel,
    pickerTags,
    onCreateProjectTag,
    mediaDisabled,
    mediaReadOnly,
    onMediaPreparationChange,
    onError,
}: PostComposerProps) {
    const { locale } = useLanguage()
    const {
        postTitle,
        postContent,
        sourceMedia,
        publicationTargets,
        publicationTagIds,
        defaultDeliveryMode,
        defaultScheduledAt,
        customizedTargetIds,
        customizedContentTargetIds,
        activePublicationTabId,
        activeContentTarget,
        activeTarget,
        resolvedActiveContentScopeId,
        activeContentTargetUsesSharedContent,
        activeText,
        onPostTitleChange,
        onSourceMediaChange,
        onPublicationTagIdsChange,
        onPublicationTargetsChange,
        selectContentScope,
        editScopeText,
        editActiveText,
        useSharedTargetContent,
        removeTarget,
        handleDefaultDeliveryModeChange,
        handleDefaultScheduledAtChange,
        handleTargetCustomizationChange,
    } = composition
    const contentReadOnly = readOnly || activeContentTarget?.locked === true
    const lockedTargetIds = new Set(
        publicationTargets.filter(target => target.locked).map(target => target.id)
    )
    const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null)
    const [availableMedia, setAvailableMedia] = useState<MediaReference[]>([])
    const [scheduleDetailsOpen, setScheduleDetailsOpen] = useState(() =>
        publicationTargets.some(
            target =>
                target.deliveryMode === 'automatic' &&
                connections.find(connection => connection.channelId === target.channelId)?.state !==
                    'active'
        )
    )
    const selectedPublicationCount = publicationTargets.filter(
        target => target.channelId !== ''
    ).length
    const [visitedEditorScopes, setVisitedEditorScopes] = useState<Set<string>>(
        () => new Set([publicationSharedTabId])
    )
    useEffect(() => {
        if (!configuredEditor) return
        setVisitedEditorScopes(current =>
            current.has(resolvedActiveContentScopeId)
                ? current
                : new Set(current).add(resolvedActiveContentScopeId)
        )
    }, [configuredEditor, resolvedActiveContentScopeId])
    const renderedEditorScopes = new Set([...visitedEditorScopes, resolvedActiveContentScopeId])
    const activePreviewTarget = activeContentTarget ?? activeTarget ?? publicationTargets[0]
    const activePreviewChannel = activeChannels.find(
        channel => channel.id === activePreviewTarget?.channelId
    )
    const profileQuery = useQuery({
        queryKey: [
            'project',
            project.id,
            'composer-channel-profile',
            activePreviewChannel?.id,
            activePreviewChannel?.profileVersionId,
        ],
        queryFn: () => api.getChannelProfileState(project.id, activePreviewChannel!.id),
        enabled: activePreviewChannel !== undefined,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const textFields = useMemo(
        () =>
            !profileQuery.isError && profileQuery.data
                ? getComposerTextFields(profileQuery.data.active.profile, { media: sourceMedia })
                : null,
        [profileQuery.data, profileQuery.isError, sourceMedia]
    )
    const showHeadline =
        headlineVisible ?? (textFields?.headline !== undefined && textFields?.headline !== null)
    const headlineCount = textFields?.headline
        ? countComposerText(postTitle, textFields.headline)
        : null
    const textRule = providerRegistry.forExecution(activePreviewChannel?.execution)?.text
    const TextCount = textRule?.Count
    const usesWeightedTextRules = textRule !== undefined
    const activeTextValidation = usesWeightedTextRules ? textRule!.parse(activeText) : null
    const bodyCount = textFields?.body ? countComposerText(activeText, textFields.body) : null
    const activeTextInvalid =
        bodyCount?.invalid === true ||
        (activeTextValidation !== null &&
            activeText.trim().length > 0 &&
            !activeTextValidation.valid)
    const previewMedia = sourceMedia
        .map(selection => availableMedia.find(asset => asset.asset.id === selection.assetId))
        .filter((asset): asset is MediaReference => asset !== undefined)
    const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

    function requestTargetRemoval(targetId: string) {
        const target = publicationTargets.find(item => item.id === targetId)
        if (target === undefined || target.locked || readOnly) return
        if (onRemoveTarget) {
            onRemoveTarget(targetId)
            return
        }
        if (
            target.content !== '' ||
            customizedContentTargetIds.has(targetId) ||
            customizedTargetIds.has(targetId)
        ) {
            setPendingRemovalId(targetId)
            return
        }
        removeTarget(targetId)
    }

    return (
        <>
            <PublicationComposer
                // The editor, title and options draw their own surfaces; a frame around them
                // would push the title label against its edge.
                editorSurface={false}
                channelNavigation={
                    channelNavigation ?? (
                        <PublicationChannelTabs
                            createChannel={createChannel}
                            activeTabId={resolvedActiveContentScopeId}
                            channels={activeChannels}
                            defaultDeliveryMode={defaultDeliveryMode}
                            defaultScheduledAt={defaultScheduledAt}
                            disabled={pending}
                            readOnly={readOnly}
                            lockedTargetIds={lockedTargetIds}
                            onChange={onPublicationTargetsChange}
                            onActiveTabChange={selectContentScope}
                            onRemoveTarget={requestTargetRemoval}
                            projectId={project.id}
                            targets={publicationTargets}
                            timeZone={project.timeZone}
                        />
                    )
                }
                editor={
                    <div className="min-w-0">
                        {activeContentTarget && channelStatus ? (
                            <div className="mb-4">{channelStatus(activeContentTarget)}</div>
                        ) : null}
                        {showHeadline ? (
                            <DashboardFormField
                                htmlFor="new-post-title"
                                label={
                                    textFields?.headline?.field.required
                                        ? m.builder_title_required()
                                        : m.builder_title_optional()
                                }>
                                <Input
                                    id="new-post-title"
                                    disabled={contentReadOnly || disabled || pending}
                                    aria-invalid={headlineCount?.invalid || undefined}
                                    aria-describedby={
                                        headlineCount ? 'new-post-title-count' : undefined
                                    }
                                    value={postTitle}
                                    onChange={event => onPostTitleChange(event.target.value)}
                                    placeholder={m.publication_new_post_title()}
                                />
                                {textFields?.headline &&
                                textFields.headline.field.maxLength !== null &&
                                headlineCount &&
                                // Like the body: a long limit appears only when it is near.
                                (headlineCount.invalid ||
                                    textFields.headline.field.maxLength <= 500 ||
                                    headlineCount.characters >=
                                        textFields.headline.field.maxLength * 0.8) ? (
                                    <p
                                        id="new-post-title-count"
                                        className={cn(
                                            'text-xs',
                                            headlineCount.invalid
                                                ? 'text-destructive'
                                                : 'text-muted-foreground'
                                        )}>
                                        {m.composer_character_count({
                                            count: formatNumber(headlineCount.characters, locale),
                                            limit: formatNumber(
                                                textFields.headline.field.maxLength,
                                                locale
                                            ),
                                        })}
                                    </p>
                                ) : null}
                            </DashboardFormField>
                        ) : null}
                        {activePreviewChannel && profileQuery.isPending ? (
                            <p role="status" className="mb-2 text-xs text-muted-foreground">
                                {m.composer_constraints_loading()}
                            </p>
                        ) : profileQuery.isError ? (
                            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <span role="status">{m.composer_constraints_unavailable()}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={profileQuery.isFetching}
                                    onClick={() => void profileQuery.refetch()}>
                                    {m.common_retry()}
                                </Button>
                            </div>
                        ) : null}

                        <div
                            data-new-publication-editor="true"
                            className="overflow-hidden rounded-xl bg-surface-field shadow-surface focus-within:shadow-control">
                            {activeContentTarget !== undefined && !contentReadOnly ? (
                                <div
                                    className="flex min-h-9 items-center justify-between gap-2 px-4 pt-2"
                                    data-channel-text-mode={
                                        activeContentTargetUsesSharedContent ? 'shared' : 'own'
                                    }>
                                    <span className="text-xs text-muted-foreground">
                                        {activeContentTargetUsesSharedContent
                                            ? m.composer_channel_shared_text()
                                            : m.composer_channel_own_text()}
                                    </span>
                                    {activeContentTargetUsesSharedContent ? null : (
                                        <ActionTooltip
                                            label={m.publication_new_reset_channel_content({
                                                channel: activePreviewChannel?.name ?? '',
                                            })}>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                disabled={pending || contentReadOnly}
                                                aria-label={m.publication_new_reset_channel_content(
                                                    {
                                                        channel: activePreviewChannel?.name ?? '',
                                                    }
                                                )}
                                                onClick={() =>
                                                    useSharedTargetContent(activeContentTarget.id)
                                                }>
                                                <RestartIcon aria-hidden="true" />
                                            </Button>
                                        </ActionTooltip>
                                    )}
                                </div>
                            ) : null}
                            <div>
                                {configuredEditor ? (
                                    <Suspense
                                        fallback={
                                            <div className="min-h-56 p-4 text-muted-foreground">
                                                {m.common_loading()}
                                            </div>
                                        }>
                                        {[
                                            {
                                                id: publicationSharedTabId,
                                                channelId: '',
                                                content: postContent,
                                                locked: false,
                                            },
                                            ...publicationTargets,
                                        ]
                                            .filter(scope => renderedEditorScopes.has(scope.id))
                                            .map(scope => {
                                                const channel = activeChannels.find(
                                                    item => item.id === scope.channelId
                                                )
                                                const profile =
                                                    scope.id === publicationSharedTabId
                                                        ? 'plain'
                                                        : getNativeEditorProfile(channel?.execution)
                                                const shared =
                                                    scope.id === publicationSharedTabId ||
                                                    !customizedContentTargetIds.has(scope.id)
                                                const visible =
                                                    scope.id === resolvedActiveContentScopeId
                                                return (
                                                    <div
                                                        key={`${project.id}:${scope.id}:${profile}`}
                                                        hidden={!visible}
                                                        data-editor-scope={scope.id}>
                                                        {scope.locked ? (
                                                            <p className="whitespace-pre-wrap p-4">
                                                                {scope.content}
                                                            </p>
                                                        ) : (
                                                            <ConfiguredPublicationEditor
                                                                onToolbarMount={
                                                                    visible
                                                                        ? setMediaToolbar
                                                                        : undefined
                                                                }
                                                                id={
                                                                    visible
                                                                        ? 'new-post-content'
                                                                        : undefined
                                                                }
                                                                profile={profile}
                                                                value={
                                                                    shared
                                                                        ? postContent
                                                                        : scope.content
                                                                }
                                                                label={
                                                                    scope.id ===
                                                                    publicationSharedTabId
                                                                        ? m.publication_new_source_content()
                                                                        : m.publication_new_channel_copy()
                                                                }
                                                                disabled={
                                                                    pending || disabled || readOnly
                                                                }
                                                                describedBy={
                                                                    visible &&
                                                                    (usesWeightedTextRules ||
                                                                        bodyCount !== null)
                                                                        ? 'new-post-content-weighted-count'
                                                                        : undefined
                                                                }
                                                                invalid={
                                                                    visible && activeTextInvalid
                                                                }
                                                                onValueChange={text =>
                                                                    editScopeText(scope.id, text)
                                                                }
                                                            />
                                                        )}
                                                    </div>
                                                )
                                            })}
                                    </Suspense>
                                ) : (
                                    <PublicationTextEditor
                                        appearance="composer"
                                        onToolbarMount={setMediaToolbar}
                                        id="new-post-content"
                                        aria-label={
                                            activeContentTarget === undefined
                                                ? m.publication_new_source_content()
                                                : m.publication_new_channel_copy()
                                        }
                                        aria-describedby={
                                            usesWeightedTextRules || bodyCount !== null
                                                ? 'new-post-content-weighted-count'
                                                : undefined
                                        }
                                        aria-invalid={activeTextInvalid || undefined}
                                        value={activeText}
                                        disabled={pending || disabled || contentReadOnly}
                                        onValueChange={editActiveText}
                                        placeholder={m.publication_new_source_placeholder()}
                                        rows={9}
                                    />
                                )}
                                {activeTextValidation !== null && TextCount ? (
                                    <div className="px-4 pb-3">
                                        <TextCount
                                            id="new-post-content-weighted-count"
                                            invalid={activeTextInvalid}
                                            result={activeTextValidation}
                                        />
                                    </div>
                                ) : bodyCount && textFields?.body ? (
                                    <PublicationTextCount
                                        id="new-post-content-weighted-count"
                                        result={bodyCount}
                                        constraint={textFields.body}
                                    />
                                ) : null}
                            </div>

                            <MediaAttachmentPicker
                                variant="publication-new-inline"
                                triggerContainer={mediaToolbar}
                                projectId={project.id}
                                value={sourceMedia}
                                onChange={onSourceMediaChange}
                                onAssetsChange={setAvailableMedia}
                                onPreparationChange={onMediaPreparationChange}
                                onError={onError}
                                disabled={mediaDisabled || contentReadOnly}
                                readOnly={mediaReadOnly || contentReadOnly}
                            />
                        </div>

                        {activeContentTarget && channelPanel
                            ? channelPanel(activeContentTarget)
                            : null}
                        {!activeContentTarget ? sharedPanel : null}
                        <div className="mt-5">
                            {tags !== undefined ? (
                                tags
                            ) : (
                                <PublicationTagPicker
                                    ariaLabel={m.taxonomy_select_tags()}
                                    archivedLabel={m.common_archived()}
                                    disabled={pending || contentReadOnly}
                                    emptyLabel={m.taxonomy_no_tags()}
                                    label={m.taxonomy_internal_tags()}
                                    manageTagsProjectId={project.id}
                                    onChange={onPublicationTagIdsChange}
                                    onCreateTag={onCreateProjectTag}
                                    selectedTagIds={publicationTagIds}
                                    selectedLabel={count => m.taxonomy_selected_tags({ count })}
                                    showSelectedTags
                                    tags={pickerTags}
                                />
                            )}
                        </div>
                    </div>
                }
                footer={footer}
                preview={
                    preview !== undefined ? (
                        preview
                    ) : activePreviewChannel !== undefined ? (
                        <PublicationDraftPreview
                            channel={activePreviewChannel}
                            execution={activePreviewChannel.execution}
                            media={previewMedia}
                            mediaSelections={sourceMedia}
                            postContent={postContent}
                            postTitle={postTitle}
                            targetContent={
                                activeContentTargetUsesSharedContent
                                    ? undefined
                                    : activePreviewTarget?.content
                            }
                        />
                    ) : undefined
                }
                settings={
                    settings !== undefined ? (
                        settings
                    ) : selectedPublicationCount > 0 ? (
                        <details
                            data-publication-schedule-disclosure="true"
                            className="group min-w-0 rounded-md bg-surface-inset/35 px-3 shadow-surface"
                            open={scheduleDetailsOpen}
                            onToggle={event => setScheduleDetailsOpen(event.currentTarget.open)}>
                            <summary
                                aria-label={m.publication_new_schedule_settings()}
                                className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
                                <CalendarMinimalisticIcon
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                                <span className="min-w-0 flex-1 truncate font-medium">
                                    {formatCivilSchedule(defaultScheduledAt, locale) ||
                                        m.date_time_picker_placeholder()}
                                </span>
                                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                                    {defaultDeliveryMode === 'automatic'
                                        ? m.publication_new_automatic_publication()
                                        : m.publication_new_manual_publication()}
                                </span>
                                <AltArrowDownIcon
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                                />
                            </summary>
                            <div className="pb-4 pt-1">
                                <PublicationChannelSettings
                                    activeTargetId={activePublicationTabId}
                                    channels={activeChannels}
                                    connections={connections}
                                    customizedTargetIds={customizedTargetIds}
                                    defaultDeliveryMode={defaultDeliveryMode}
                                    defaultScheduledAt={defaultScheduledAt}
                                    disabled={pending || contentReadOnly}
                                    onDefaultDeliveryModeChange={handleDefaultDeliveryModeChange}
                                    onDefaultScheduledAtChange={handleDefaultScheduledAtChange}
                                    onChange={onPublicationTargetsChange}
                                    onTargetCustomizationChange={handleTargetCustomizationChange}
                                    projectId={project.id}
                                    targets={publicationTargets}
                                    timeZone={project.timeZone}
                                />
                            </div>
                        </details>
                    ) : undefined
                }
            />
            <Dialog
                open={pendingRemovalId !== null}
                onOpenChange={open => {
                    if (!open) setPendingRemovalId(null)
                }}>
                <DialogContent>
                    <DialogTitle>{m.publication_remove_customized_title()}</DialogTitle>
                    <DialogDescription>
                        {m.publication_remove_customized_description()}
                    </DialogDescription>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setPendingRemovalId(null)}>
                            {m.publication_remove_customized_cancel()}
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                if (pendingRemovalId !== null) removeTarget(pendingRemovalId)
                                setPendingRemovalId(null)
                            }}>
                            {m.publication_remove_customized_confirm()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
