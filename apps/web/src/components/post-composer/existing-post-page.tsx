import { Button, buttonVariants } from '@postdot/ui/components/button'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useState, useEffect, type SetStateAction } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { PublicationStatus, formatSchedule } from '@/components/dashboard-publication-parts'
import { ChannelAvatar } from '@/components/identity-visuals'
import { LanguageCombobox } from '@/components/language-combobox'
import { PostSourceReview } from '@/components/post-source-review'
import {
    PublicationEditorSaveIndicator,
    PublicationEditorStatus,
} from '@/components/publication-editor-status'
import { useProjectLifecycle } from '@/components/resource-lifecycle-section'
import {
    applyPostToChannel,
    channelVersionFollowsSource,
    postFromChannelVersion,
} from '@/lib/channel-version-follow'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { countStaleChannelVersions } from '@/lib/post-source-review'
import { shortExcerpt } from '@/lib/publication-identity'
import { getTargetPreviewBody } from '@/lib/publication-preview'
import { getTargetEditorFields } from '@/lib/target-editor'
import type { MediaSelection } from '@/lib/target-media'
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
import { useExistingPostComposition, type ExistingPostData } from './use-existing-post-composition'
import { usePostEditorAccess } from './use-post-editor-access'

const PostChannelPanel = lazy(() =>
    import('./post-channel-panel').then(module => ({ default: module.PostChannelPanel }))
)

export function ExistingPostPage({ initialData }: { readonly initialData: ExistingPostData }) {
    const { locale } = useLanguage()
    const { project, channels, connections } = useProjectDashboard()
    const access = usePostEditorAccess(project.id)
    const lifecycle = useProjectLifecycle(project.id)
    const readOnly = access.role === 'viewer' || lifecycle.data?.state !== 'active'
    const session = useExistingPostComposition({
        initialData,
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

    if (!lifecycle.data) return null
    if (access.status === 'denied')
        return <main className="px-4 py-8 sm:px-6 lg:px-8">{access.notice}</main>
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
    const pendingApply = data.editors.some(
        editor =>
            !composition.publicationTargets.find(target => target.id === editor.publication.id)
                ?.locked && channelHasPendingChanges(editor)
    )
    return (
        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            {access.notice}
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
                        to="/dashboard/projects/$projectId/queue"
                        params={{ projectId: project.id }}
                        search={{ filter: undefined, sort: undefined, tagIds: undefined }}>
                        <AltArrowLeftIcon aria-hidden="true" />
                        {m.editor_back_to_queue()}
                    </Link>
                }
            />
            <PublicationEditorStatus
                message={session.message}
                passive={session.passive}
                saveState={session.saveState}
                onReviewConflict={() => void session.reload()}
            />
            {!readOnly ? (
                <PostSourceReview
                    projectId={project.id}
                    postId={data.post.id}
                    staleCount={staleCount}
                    accessEpoch={access.epoch}
                    disabled={blocked || session.dirty || session.saving}
                    onApplied={() => void session.reload()}
                />
            ) : null}
            {activeTarget && !activeTarget.locked ? (
                <p className="mb-3 text-xs text-muted-foreground" data-channel-version-mode="true">
                    {activeTarget.customized
                        ? m.editor_channel_customized()
                        : m.editor_channel_follows()}
                </p>
            ) : null}
            <PostComposer
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
                                key={target.id}
                                editor={activeEditor}
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
                pending={false}
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
                        onSelect={composition.selectContentScope}
                    />
                }
            />
            {!activeEditor ? (
                <section
                    className="mx-auto mt-6 min-w-0 max-w-6xl"
                    aria-label={m.post_destinations()}>
                    <h2 className="mb-3 text-sm font-medium">{m.post_destinations()}</h2>
                    {data.editors.map(editor => (
                        <div
                            key={editor.publication.id}
                            className="flex min-w-0 flex-wrap items-center gap-3 py-2">
                            <Button
                                variant="ghost"
                                className="min-w-0"
                                onClick={() =>
                                    composition.selectContentScope(editor.publication.id)
                                }>
                                <ChannelAvatar channel={editor.channel} size="sm" />
                                <span className="truncate">{editor.channel.name}</span>
                            </Button>
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
        </main>
    )
}
