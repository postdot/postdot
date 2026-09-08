import { Button } from '@herald/ui/components/button'
import { ArrowLeftIcon } from '@solar-icons/react/bold/arrow-left'
import { GalleryIcon } from '@solar-icons/react/bold/gallery'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaLibraryPage() {
    useLanguage()
    const { onSourceMediaChange, project, sourceMedia } = useProjectDashboard()

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader
                action={
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                params={{ projectId: project.id }}
                                search={{ date: undefined }}
                                to="/dashboard/projects/$projectId/compose"
                            />
                        }
                        variant="ghost">
                        <ArrowLeftIcon aria-hidden="true" />
                        {m.media_back_to_compose()}
                    </Button>
                }
                title={m.media_title()}>
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            <section className="max-w-4xl">
                <div className="mb-3 flex justify-end">
                    <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                        <GalleryIcon aria-hidden="true" className="size-4" />
                        {m.common_media_selected({ count: sourceMedia.length })}
                    </span>
                </div>
                <MediaAttachmentPicker
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    value={sourceMedia}
                    onChange={onSourceMediaChange}
                />
            </section>
        </main>
    )
}
