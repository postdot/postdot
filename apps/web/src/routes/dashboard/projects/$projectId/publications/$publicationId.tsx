import { Button, buttonVariants } from '@herald/ui/components/button'
import { RefreshIcon } from '@solar-icons/react/linear/refresh'
import { useQuery } from '@tanstack/react-query'
import {
    createFileRoute,
    Link,
    redirect,
    useRouter,
    type ErrorComponentProps,
} from '@tanstack/react-router'
import { useCallback, useEffect, useId, useReducer, useRef } from 'react'

import { AddPostDestination } from '@/components/add-post-destination'
import { EmptyState } from '@/components/empty-state'
import { PublicationEditor } from '@/components/publication-editor'
import { api, ApiError } from '@/lib/api'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import {
    classifyMembershipVerificationError,
    createProjectAccessState,
    projectAccessReducer,
} from '@/lib/project-access-verification'
import { projectQueryKeys, subscribeProjectAccessRevocation } from '@/lib/project-realtime'
import { isCalendarDateKey } from '@/lib/publication-calendar'
import {
    isPublicationCalendarView,
    type PublicationCalendarView,
} from '@/lib/publication-calendar-events'
import * as m from '@/paraglide/messages.js'

export interface PublicationEditorSearch {
    editor?: 'tiptap' | 'legacy'
    from?: 'calendar'
    date?: string
    view?: PublicationCalendarView
}

export const Route = createFileRoute('/dashboard/projects/$projectId/publications/$publicationId')({
    validateSearch: (search: Record<string, unknown>): PublicationEditorSearch => ({
        ...(import.meta.env.DEV && (search.editor === 'tiptap' || search.editor === 'legacy')
            ? { editor: search.editor as 'tiptap' | 'legacy' }
            : {}),
        ...(search.from === 'calendar' ? { from: 'calendar' as const } : {}),
        ...(isCalendarDateKey(search.date) ? { date: search.date } : {}),
        ...(isPublicationCalendarView(search.view) ? { view: search.view } : {}),
    }),
    loader: async ({ params }) => {
        const session = await api.getSession()
        if (session === null) {
            throw redirect({ to: '/login', search: { continue: undefined } })
        }

        const [{ editor }, { publications }, { tags: projectTags }, { tags: publicationTags }] =
            await Promise.all([
                api.getPublicationEditor(params.projectId, params.publicationId),
                api.listPublications(params.projectId, { limit: 100 }),
                api.listProjectTags(params.projectId, { includeArchived: true }),
                api.listPublicationTags(params.projectId, params.publicationId),
            ])
        const relatedPublications = publications.filter(
            publication => publication.postId === editor.post.id
        )
        return { editor, projectTags, publicationTags, relatedPublications }
    },
    component: PublicationEditorRoute,
    errorComponent: PublicationUnavailable,
})

function PublicationEditorRoute() {
    const router = useRouter()
    const { projectId, publicationId } = Route.useParams()
    const { date, from, view, editor: editorEngine } = Route.useSearch()
    const { editor, projectTags, publicationTags, relatedPublications } = Route.useLoaderData()
    const {
        activeChannels,
        connections,
        onCancelPublications,
        onPublish,
        onRetryPublication,
        project,
        projectRole,
    } = useProjectDashboard()
    const [access, dispatchAccess] = useReducer(
        projectAccessReducer,
        undefined,
        createProjectAccessState
    )
    const accessRef = useRef(access)
    useEffect(() => {
        accessRef.current = access
    })

    // A verification override only stands until ordinary project data
    // refreshes: any context role change afterwards is strictly fresher.
    useEffect(() => {
        if (accessRef.current.role !== null) dispatchAccess({ type: 'clear-role-override' })
    }, [projectRole])

    // Synchronous check-and-set: several triggers processed before the next
    // render share the same stale status, so the status guard alone cannot
    // deduplicate them. The ref guarantees a single verification launch per
    // epoch even when refusals land in the same microtask drain.
    const verificationRequestEpoch = useRef<number | null>(null)

    const verifyAccess = useCallback(
        async (epoch: number) => {
            try {
                const { membership } = await api.getProjectMembership(projectId)
                if (accessRef.current.epoch !== epoch) return
                dispatchAccess({ type: 'verification-succeeded', role: membership.role })
            } catch (error) {
                if (accessRef.current.epoch !== epoch) return
                dispatchAccess({ type: classifyMembershipVerificationError(error) })
            } finally {
                if (verificationRequestEpoch.current === epoch)
                    verificationRequestEpoch.current = null
            }
        },
        [projectId]
    )

    const requestVerification = useCallback(
        (action: 'access-revoked' | 'refetch-refused' | 'retry-verification') => {
            const previous = accessRef.current
            if (action === 'retry-verification') {
                if (previous.status !== 'technical-error') return
            } else if (previous.status !== 'confirmed') return
            const epoch = previous.epoch + 1
            if (verificationRequestEpoch.current === epoch) return
            verificationRequestEpoch.current = epoch
            dispatchAccess({ type: action })
            void verifyAccess(epoch)
        },
        [verifyAccess]
    )

    useEffect(
        () =>
            subscribeProjectAccessRevocation(projectId, () => {
                requestVerification('access-revoked')
            }),
        [projectId, requestVerification]
    )

    const retryAccessVerification = useCallback(() => {
        requestVerification('retry-verification')
    }, [requestVerification])

    const handleAccessReconciled = useCallback((succeeded: boolean) => {
        dispatchAccess({ type: succeeded ? 'reconcile-succeeded' : 'reconcile-failed' })
    }, [])

    // An authoritative refusal from an editor-owned request carries the same
    // ambiguity as the stream signal when transports degrade, so it starts the
    // same one-shot verification instead of leaving stale actions armed.
    const handleEditorRequestRefused = useCallback(() => {
        requestVerification('refetch-refused')
    }, [requestVerification])

    const effectiveRole = access.role ?? projectRole
    const routeReadOnly = effectiveRole === 'viewer'
    const accessBlocked = access.status !== 'confirmed'
    const canAct = !routeReadOnly && !accessBlocked

    const readOnly = routeReadOnly
    const instanceId = useId()
    const editorQuery = useQuery({
        queryKey: projectQueryKeys.publicationEditorInstance(projectId, publicationId, instanceId),
        queryFn: () => api.getPublicationEditor(projectId, publicationId),
        initialData: { editor },
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const currentEditor = editorQuery.data?.editor ?? editor

    // A refused refetch of previously loaded data starts the same one-shot
    // verification: through a degraded transport the in-band signal may never
    // arrive, while the refusal is equally ambiguous.
    const editorQueryError = editorQuery.error
    const editorQueryHasData = editorQuery.data !== undefined
    useEffect(() => {
        if (!(editorQueryError instanceof ApiError)) return
        if (editorQueryError.status !== 403 && editorQueryError.status !== 404) return
        if (!editorQueryHasData) return
        requestVerification('refetch-refused')
    }, [editorQueryError, editorQueryHasData, requestVerification])

    if (access.status === 'denied') return <AccessRemovedSurface />

    return (
        <>
            {access.status === 'verifying' ? <AccessVerifyingNotice /> : null}
            {access.status === 'reconciling' ? <AccessReconcilingNotice /> : null}
            {access.status === 'technical-error' ? (
                <AccessTechnicalErrorNotice onRetry={retryAccessVerification} />
            ) : null}
            {canAct ? (
                <div className="flex justify-end pb-3">
                    <AddPostDestination
                        projectId={projectId}
                        postId={currentEditor.post.id}
                        channels={activeChannels}
                        onAdded={async publicationId => {
                            await router.invalidate()
                            await router.navigate({
                                to: '/dashboard/projects/$projectId/publications/$publicationId',
                                params: { projectId, publicationId },
                            })
                        }}
                    />
                </div>
            ) : null}
            <PublicationEditor
                key={currentEditor.draft.id}
                projectId={projectId}
                configuredEditor={!(import.meta.env.DEV && editorEngine === 'legacy')}
                initialEditor={currentEditor}
                initialPublicationTags={publicationTags}
                onCancel={
                    canAct ? () => onCancelPublications([currentEditor.publication.id]) : undefined
                }
                onPublish={canAct ? () => onPublish(currentEditor.publication.id) : undefined}
                onRetry={
                    canAct ? () => onRetryPublication(currentEditor.publication.id) : undefined
                }
                projectTags={projectTags}
                readOnly={readOnly}
                accessStatus={access.status}
                accessEpoch={access.epoch}
                onAccessRefused={handleEditorRequestRefused}
                onAccessReconciled={handleAccessReconciled}
                channels={activeChannels}
                publisherConnections={connections}
                relatedPublications={relatedPublications}
                backToCalendar={from === 'calendar' ? { date, view } : undefined}
                timeZone={project.timeZone}
            />
        </>
    )
}

function AccessVerifyingNotice() {
    useLanguage()
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
            <p
                role="status"
                className="rounded-md bg-surface-inset/35 px-3 py-2.5 text-sm text-muted-foreground shadow-surface">
                {m.editor_access_checking()}
            </p>
        </div>
    )
}

function AccessReconcilingNotice() {
    useLanguage()
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
            <p
                role="status"
                className="rounded-md bg-surface-inset/35 px-3 py-2.5 text-sm text-muted-foreground shadow-surface">
                {m.editor_access_reconciling()}
            </p>
        </div>
    )
}

function AccessTechnicalErrorNotice({ onRetry }: { readonly onRetry: () => void }) {
    useLanguage()
    return (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-8">
            <EmptyState
                action={
                    <Button onClick={onRetry} size="sm" variant="ghost">
                        <RefreshIcon aria-hidden="true" />
                        {m.common_retry()}
                    </Button>
                }
                layout="compact"
                title={m.editor_application_unconfirmed()}
            />
        </div>
    )
}

function AccessRemovedSurface() {
    useLanguage()
    return (
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            <EmptyState
                action={
                    <Link
                        className={buttonVariants({ variant: 'default' })}
                        to="/dashboard"
                        search={{ projectId: 'none' }}>
                        {m.nav_select_project()}
                    </Link>
                }
                description={m.dashboard_select_project_description()}
                illustration="access"
                title={m.editor_access_denied_title()}
            />
        </main>
    )
}

function PublicationUnavailable({ error, reset }: ErrorComponentProps) {
    const { projectId } = Route.useParams()
    const router = useRouter()
    const unavailable = error instanceof ApiError && (error.status === 403 || error.status === 404)
    return (
        <div className="mx-auto grid max-w-md justify-items-center gap-4 px-6 py-12 text-center">
            <h1 className="font-heading text-xl font-semibold">
                {unavailable ? m.notifications_subject_unavailable() : m.common_error_title()}
            </h1>
            {unavailable ? null : (
                <p className="text-sm text-muted-foreground">{m.common_error_description()}</p>
            )}
            <div className="flex flex-wrap justify-center gap-3">
                <Link
                    className={buttonVariants({ variant: 'secondary' })}
                    to="/dashboard/projects/$projectId/overview"
                    params={{ projectId }}>
                    {m.nav_overview()}
                </Link>
                {unavailable ? null : (
                    <Button
                        onClick={() => {
                            reset()
                            void router.invalidate()
                        }}>
                        {m.common_retry()}
                    </Button>
                )}
            </div>
        </div>
    )
}
