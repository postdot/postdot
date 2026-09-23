import { Button } from '@herald/ui/components/button'
import { UploadIcon } from '@solar-icons/react/bold/upload'

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
            <section className="w-full">
                <MediaAttachmentPicker
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    renderHeader={({ disabled, onImport, uploading }) => (
                        <DashboardPageHeader
                            title={m.media_title()}
                            action={
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
                            }
                        />
                    )}
                    selectionMode="manage"
                    value={[]}
                    onChange={ignoreMediaSelection}
                />
            </section>
        </main>
    )
}

function ignoreMediaSelection() {}
