import { Button } from '@herald/ui/components/button'
import { AddIcon } from '@solar-icons/react/bold/add'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaLibraryPage() {
    useLanguage()
    const { project } = useProjectDashboard()

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
                                to="/dashboard/projects/$projectId/publications/new"
                            />
                        }
                        variant="default">
                        <AddIcon aria-hidden="true" />
                        {m.nav_new_publication()}
                    </Button>
                }
                title={m.media_title()}>
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            <section className="max-w-4xl">
                <MediaAttachmentPicker
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    selectionMode="manage"
                    value={[]}
                    onChange={ignoreMediaSelection}
                />
            </section>
        </main>
    )
}

function ignoreMediaSelection() {}
