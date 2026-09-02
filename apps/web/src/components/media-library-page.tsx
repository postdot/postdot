import { Button } from '@herald/ui/components/button'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { GalleryIcon } from '@solar-icons/react/bold/gallery'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function MediaLibraryPage() {
    const { onSourceMediaChange, project, sourceMedia } = useProjectDashboard()

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                to="/dashboard/projects/$projectId/compose"
                                params={{ projectId: project.id }}
                            />
                        }
                        variant="ghost">
                        <ArrowLeftIcon aria-hidden="true" />
                        Compose
                    </Button>
                }
                title="Media">
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            <section className="max-w-4xl">
                <div className="flex items-baseline justify-between gap-4">
                    <div>
                        <h2 className="font-heading text-2xl font-[580] leading-[1.03] tracking-[-0.05em]">
                            Verified media
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Upload once and keep the current compose draft's attachments available
                            while you move between workspace pages.
                        </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                        <GalleryIcon aria-hidden="true" className="size-4" />
                        {sourceMedia.length} selected
                    </span>
                </div>
                <div className="mt-5">
                    <MediaAttachmentPicker
                        projectId={project.id}
                        value={sourceMedia}
                        onChange={onSourceMediaChange}
                    />
                </div>
            </section>
        </main>
    )
}
