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
import { useLanguage } from '@/lib/i18n'
import { calendarDateTimeLocal } from '@/lib/publication-authoring'
import * as m from '@/paraglide/messages.js'

export function PublicationComposer({ calendarDate }: { readonly calendarDate?: string }) {
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
                        {m.compose_back_overview()}
                    </Button>
                }
                title={m.compose_title()}>
                <p className="mt-2 text-sm text-muted-foreground">
                    {project.name} · {project.timeZone}
                </p>
            </DashboardPageHeader>

            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>{m.compose_action_failed()}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <form onSubmit={onCreatePost}>
                <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
                    <section className="min-w-0">
                        <div className="flex items-baseline justify-between gap-4">
                            <div>
                                <h2 className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                    {m.compose_source()}
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {m.compose_source_description()}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {m.compose_shared_content()}
                            </span>
                        </div>

                        <div className="mt-5 space-y-5">
                            <DashboardFormField
                                htmlFor="new-post-title"
                                label={m.compose_post_title()}
                                hint={m.compose_post_title_hint()}>
                                <Input
                                    id="new-post-title"
                                    value={postTitle}
                                    onChange={event => onPostTitleChange(event.target.value)}
                                    placeholder={m.compose_optional_source_title()}
                                />
                            </DashboardFormField>
                            <DashboardFormField
                                htmlFor="new-post-content"
                                label={m.compose_source_content()}
                                hint={m.compose_target_copy_hint()}>
                                <Textarea
                                    id="new-post-content"
                                    value={postContent}
                                    onChange={event => onPostContentChange(event.target.value)}
                                    placeholder={m.compose_source_placeholder()}
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
                                    {m.compose_destinations()}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    {m.compose_destinations_description()}
                                </CardDescription>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {m.compose_target_count({ count: publicationTargets.length })}
                            </span>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <PublicationTargetList
                                channels={activeChannels}
                                connections={connections}
                                disabled={pending}
                                onChange={onPublicationTargetsChange}
                                projectId={project.id}
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
                                ? m.compose_delivery_automatic()
                                : m.compose_delivery_manual()
                            : m.compose_delivery_independent()}
                    </p>
                    <Button type="submit" disabled={pending || activeChannels.length === 0}>
                        <CalendarAddIcon aria-hidden="true" />
                        {publicationTargets.length === 1
                            ? publicationTargets[0]?.deliveryMode === 'automatic'
                                ? m.compose_schedule_automatic()
                                : m.compose_schedule_manual()
                            : m.compose_schedule_count({ count: publicationTargets.length })}
                    </Button>
                </div>
            </form>

            {activeChannels.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{m.compose_add_channel()}</p>
            ) : null}
        </main>
    )
}
