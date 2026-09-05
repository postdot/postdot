import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@herald/ui/components/card'
import { Input } from '@herald/ui/components/input'
import { Textarea } from '@herald/ui/components/textarea'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { DashboardFormField } from '@/components/dashboard-form-field'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { PublicationTargetList } from '@/components/publication-target-list'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { calendarDateTimeLocal } from '@/lib/publication-authoring'

export function PublicationComposer({ calendarDate }: { readonly calendarDate?: string }) {
    const {
        activeChannels,
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
        publicationTargets,
        sourceMedia,
    } = useProjectDashboard()
    const appliedCalendarDate = useRef<string | undefined>(undefined)

    useEffect(() => {
        if (
            calendarDate === undefined ||
            appliedCalendarDate.current === calendarDate ||
            publicationTargets.length === 0
        ) {
            return
        }

        const scheduledAt = calendarDateTimeLocal(calendarDate)
        if (scheduledAt === undefined) return

        appliedCalendarDate.current = calendarDate
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map((target, index) =>
                index === 0 ? { ...target, scheduledAt } : target
            )
        )
    }, [calendarDate, onPublicationTargetsChange, publicationTargets.length])

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                to="/dashboard/projects/$projectId/overview"
                                params={{ projectId: project.id }}
                            />
                        }
                        variant="ghost">
                        <ArrowLeftIcon aria-hidden="true" />
                        Overview
                    </Button>
                }
                title="Compose">
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>Publication action failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form onSubmit={onCreatePost}>
                <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
                    <section className="min-w-0">
                        <div className="flex items-baseline justify-between gap-4">
                            <div>
                                <h2 className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                    Source
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    One source can feed several destination publications.
                                </p>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                Shared content
                            </span>
                        </div>

                        <div className="mt-5 space-y-5">
                            <DashboardFormField
                                htmlFor="new-post-title"
                                label="Post title"
                                hint="Optional context for the source post.">
                                <Input
                                    id="new-post-title"
                                    value={postTitle}
                                    onChange={event => onPostTitleChange(event.target.value)}
                                    placeholder="Optional source title"
                                />
                            </DashboardFormField>
                            <DashboardFormField
                                htmlFor="new-post-content"
                                label="Source content"
                                hint="Target-specific copy can be added on the right.">
                                <Textarea
                                    id="new-post-content"
                                    value={postContent}
                                    onChange={event => onPostContentChange(event.target.value)}
                                    placeholder="Write the source content…"
                                    rows={10}
                                    className="min-h-52 leading-6"
                                />
                            </DashboardFormField>
                            <MediaAttachmentPicker
                                projectId={project.id}
                                value={sourceMedia}
                                onChange={onSourceMediaChange}
                                disabled={pending}
                            />
                        </div>
                    </section>

                    <Card className="min-w-0 bg-muted">
                        <CardHeader className="flex flex-row items-baseline justify-between gap-4">
                            <div className="min-w-0">
                                <CardTitle className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                    Destinations
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    Review copy, delivery, and timing per channel.
                                </CardDescription>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {publicationTargets.length} target
                                {publicationTargets.length === 1 ? '' : 's'}
                            </span>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <PublicationTargetList
                                channels={activeChannels}
                                disabled={pending}
                                onChange={onPublicationTargetsChange}
                                targets={publicationTargets}
                                timeZone={project.timeZone}
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-7 flex flex-col justify-between gap-4 rounded-lg bg-muted p-4 sm:flex-row sm:items-center sm:p-5">
                    <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                        {publicationTargets.length === 1
                            ? publicationTargets[0]?.deliveryMode === 'automatic'
                                ? 'The worker will deliver this target when its channel connection is ready.'
                                : 'A human will complete this target from the due-work queue.'
                            : 'Each destination is scheduled independently and keeps its own delivery outcome.'}
                    </p>
                    <Button type="submit" disabled={pending || activeChannels.length === 0}>
                        <CalendarAddIcon aria-hidden="true" />
                        {publicationTargets.length === 1
                            ? `Schedule ${publicationTargets[0]?.deliveryMode === 'automatic' ? 'automatic' : 'manual'} publication`
                            : `Schedule ${publicationTargets.length} publications`}
                    </Button>
                </div>
            </form>

            {activeChannels.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    Add a channel before scheduling a publication.
                </p>
            ) : null}
        </main>
    )
}
