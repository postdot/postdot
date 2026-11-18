import { Button, buttonVariants } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { useQuery } from '@tanstack/react-query'
import {
    createFileRoute,
    Link,
    redirect,
    useRouter,
    type ErrorComponentProps,
} from '@tanstack/react-router'
import { useId } from 'react'

import { ExistingPostPage } from '@/components/post-composer/existing-post-page'
import { loadExistingPost } from '@/components/post-composer/load-existing-post'
import { api, ApiError } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { projectQueryKeys } from '@/lib/project-realtime'
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
        if ((await api.getSession()) === null)
            throw redirect({ to: '/login', search: { continue: undefined } })
        const { editor } = await api.getPublicationEditor(params.projectId, params.publicationId)
        return loadExistingPost(params.projectId, editor.post.id, editor)
    },
    component: PublicationEditorRoute,
    errorComponent: PublicationUnavailable,
})

function PublicationEditorRoute() {
    const { projectId, publicationId } = Route.useParams()
    const { date, from, view, editor: editorEngine } = Route.useSearch()
    const initialData = Route.useLoaderData()
    const instanceId = useId()
    const query = useQuery({
        queryKey: [
            ...projectQueryKeys.publicationEditors(projectId),
            'post',
            initialData.post.id,
            instanceId,
        ],
        queryFn: () => loadExistingPost(projectId, initialData.post.id),
        initialData,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    return (
        <ExistingPostPage
            key={initialData.post.id}
            initialData={query.data}
            activePublicationId={publicationId}
            queryError={query.error}
            backToCalendar={from === 'calendar' ? { date, view } : undefined}
            configuredEditor={!(import.meta.env.DEV && editorEngine === 'legacy')}
        />
    )
}

function PublicationUnavailable({ error, reset }: ErrorComponentProps) {
    useLanguage()
    const { projectId } = Route.useParams()
    const { from, date, view } = Route.useSearch()
    const router = useRouter()
    const unavailable = error instanceof ApiError && (error.status === 403 || error.status === 404)
    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto grid max-w-md justify-items-center gap-4 px-6 py-12 text-center">
                <h1 className="font-heading text-xl font-semibold">
                    {unavailable ? m.notifications_subject_unavailable() : m.common_error_title()}
                </h1>
                <p className="text-sm text-muted-foreground">
                    {unavailable
                        ? m.detail_unavailable_description()
                        : m.common_error_description()}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                    <Link
                        className={buttonVariants({ variant: 'secondary' })}
                        to={
                            from === 'calendar'
                                ? '/dashboard/projects/$projectId/overview'
                                : '/dashboard/projects/$projectId/queue'
                        }
                        search={
                            from === 'calendar'
                                ? { date, view }
                                : { filter: undefined, sort: undefined, tagIds: undefined }
                        }
                        params={{ projectId }}>
                        <AltArrowLeftIcon aria-hidden="true" />
                        {from === 'calendar'
                            ? m.editor_back_to_calendar()
                            : m.editor_back_to_queue()}
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
        </main>
    )
}
