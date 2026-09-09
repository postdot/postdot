import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import { Input } from '@herald/ui/components/input'
import { Textarea } from '@herald/ui/components/textarea'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { CalendarAddIcon } from '@solar-icons/react/bold/calendar-add'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { DashboardFormField } from '@/components/dashboard-form-field'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { PublicationTargetList } from '@/components/publication-target-list'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import { calendarDateTimeLocal, type DeliveryMode } from '@/lib/publication-authoring'
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
    const [defaultDeliveryMode, setDefaultDeliveryMode] = useState<DeliveryMode>(
        () => publicationTargets[0]?.deliveryMode ?? 'manual'
    )
    const [defaultScheduledAt, setDefaultScheduledAt] = useState(
        () => publicationTargets[0]?.scheduledAt ?? ''
    )
    const [customizedTargetIds, setCustomizedTargetIds] = useState<Set<string>>(() => new Set())
    const previousTargetIds = useRef(new Set(publicationTargets.map(target => target.id)))

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
        setDefaultScheduledAt(scheduledAt)
        onPublicationTargetsChange(currentTargets =>
            currentTargets.map(target =>
                customizedTargetIds.has(target.id) ? target : { ...target, scheduledAt }
            )
        )
    }, [calendarDate, customizedTargetIds, onPublicationTargetsChange, publicationTargets.length])

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
                <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.06fr)_minmax(20rem,0.94fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
                    <section className="min-w-0">
                        <h2 className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                            {m.compose_source()}
                        </h2>

                        <div className="mt-4 rounded-lg bg-muted/70 p-4 shadow-surface sm:p-5">
                            <div className="space-y-4">
                                <DashboardFormField
                                    htmlFor="new-post-title"
                                    label={m.compose_post_title()}>
                                    <Input
                                        id="new-post-title"
                                        value={postTitle}
                                        onChange={event => onPostTitleChange(event.target.value)}
                                        placeholder={m.compose_optional_source_title()}
                                    />
                                </DashboardFormField>
                                <DashboardFormField
                                    htmlFor="new-post-content"
                                    label={m.compose_source_content()}>
                                    <div
                                        data-composer-editor="true"
                                        className="overflow-hidden rounded-md bg-background shadow-field ring-1 ring-border/70">
                                        <Textarea
                                            id="new-post-content"
                                            value={postContent}
                                            onChange={event =>
                                                onPostContentChange(event.target.value)
                                            }
                                            placeholder={m.compose_source_placeholder()}
                                            rows={10}
                                            className="min-h-52 resize-y rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                                        />
                                        <MediaAttachmentPicker
                                            variant="composer-inline"
                                            projectId={project.id}
                                            value={sourceMedia}
                                            onChange={onSourceMediaChange}
                                            disabled={pending}
                                        />
                                    </div>
                                </DashboardFormField>
                            </div>
                        </div>
                    </section>

                    <section className="min-w-0">
                        <div className="flex items-baseline justify-between gap-4">
                            <h2 className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                                {m.compose_destinations()}
                            </h2>
                            <span className="shrink-0 text-xs text-muted-foreground">
                                {m.compose_target_count({ count: publicationTargets.length })}
                            </span>
                        </div>
                        <div className="mt-4">
                            <PublicationTargetList
                                channels={activeChannels}
                                connections={connections}
                                customizedTargetIds={customizedTargetIds}
                                defaultDeliveryMode={defaultDeliveryMode}
                                defaultScheduledAt={defaultScheduledAt}
                                disabled={pending}
                                onDefaultDeliveryModeChange={handleDefaultDeliveryModeChange}
                                onDefaultScheduledAtChange={handleDefaultScheduledAtChange}
                                onChange={onPublicationTargetsChange}
                                onTargetCustomizationChange={handleTargetCustomizationChange}
                                projectId={project.id}
                                targets={publicationTargets}
                                timeZone={project.timeZone}
                            />
                        </div>
                    </section>
                </div>

                <div className="mt-7 flex justify-end rounded-lg bg-muted p-4 sm:p-5">
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
