import { Button, buttonVariants } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { ChannelAvatar } from '@/components/identity-visuals'
import {
    PublicationEditorSaveIndicator,
    PublicationEditorStatus,
} from '@/components/publication-editor-status'
import { useProjectLifecycle } from '@/components/resource-lifecycle-section'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { shortExcerpt } from '@/lib/publication-identity'
import * as m from '@/paraglide/messages.js'

import { channelHasPendingChanges } from './existing-post-composition'
import { PostComposer } from './post-composer'
import { useExistingPostComposition, type ExistingPostData } from './use-existing-post-composition'
import { usePostEditorAccess } from './use-post-editor-access'

export function ExistingPostPage({ initialData }: { readonly initialData: ExistingPostData }) {
    useLanguage()
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
        onAccessRefused: access.onAccessRefused,
        onAccessReconciled: access.onAccessReconciled,
    })
    const { composition, data } = session
    if (!lifecycle.data) return null
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
            <DashboardPageHeader
                title={
                    data.post.title ||
                    shortExcerpt(composition.postContent || composition.postTitle) ||
                    m.publication_untitled()
                }
                action={
                    <PublicationEditorSaveIndicator
                        state={session.saveState}
                        pendingApply={pendingApply || session.dirty}
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
            <PostComposer
                composition={composition}
                project={project}
                activeChannels={channels}
                connections={connections}
                pending={false}
                disabled={access.status !== 'confirmed'}
                readOnly={readOnly}
                mediaDisabled={readOnly || access.status !== 'confirmed'}
                mediaReadOnly={readOnly}
                onMediaPreparationChange={() => {}}
                onError={() => false}
                pickerTags={[]}
                tags={null}
                settings={null}
                channelNavigation={
                    <div
                        data-publication-channel-selection="true"
                        className="flex min-w-0 flex-wrap gap-2">
                        <Button
                            variant="ghost"
                            aria-pressed={composition.activeContentScopeId === 'shared'}
                            onClick={() => composition.selectContentScope('shared')}>
                            {m.publication_new_common_tab()}
                        </Button>
                        {composition.publicationTargets.map(target => {
                            const channel = channels.find(
                                channel => channel.id === target.channelId
                            )
                            return channel ? (
                                <Button
                                    key={target.id}
                                    variant="ghost"
                                    aria-label={channel.name}
                                    aria-pressed={composition.activeContentScopeId === target.id}
                                    onClick={() => composition.selectContentScope(target.id)}>
                                    <ChannelAvatar channel={channel} size="sm" />
                                    <span className="max-w-48 truncate">{channel.name}</span>
                                </Button>
                            ) : null
                        })}
                    </div>
                }
            />
        </main>
    )
}
