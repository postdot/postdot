import { Button } from '@herald/ui/components/button'
import { UploadIcon } from '@solar-icons/react/linear/upload'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaLibraryPage() {
    useLanguage()
    const { project, projectRole } = useProjectDashboard()
    const readOnly = projectRole === 'viewer'

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <section className="w-full">
                <MediaAttachmentPicker
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    renderHeader={({ disabled, onImport, uploading, view }) => (
                        <DashboardPageHeader
                            title={m.media_title()}
                            action={
                                readOnly || view === 'trash' ? undefined : (
                                    <Button
                                        type="button"
                                        disabled={disabled}
                                        className="shadow-none"
                                        onClick={onImport}>
                                        <UploadIcon aria-hidden="true" />
                                        {uploading === null
                                            ? m.media_import()
                                            : m.media_uploading({ filename: uploading })}
                                    </Button>
                                )
                            }
                        />
                    )}
                    readOnly={readOnly}
                    selectionMode="manage"
                    value={[]}
                    onChange={ignoreMediaSelection}
                />
            </section>
        </main>
    )
}

function ignoreMediaSelection() {}
