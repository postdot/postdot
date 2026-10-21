import { Button, buttonVariants } from '@postdot/ui/components/button'
import { AltArrowLeftIcon } from '@solar-icons/react/linear/alt-arrow-left'
import { UploadIcon } from '@solar-icons/react/linear/upload'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { MediaAttachmentPicker } from '@/components/media-attachment-picker'
import { useProjectDashboard } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaLibraryPage() {
    useLanguage()
    const navigate = useNavigate({ from: '/dashboard/projects/$projectId/media' })
    const { assetId } = useSearch({ from: '/dashboard/projects/$projectId/media' })
    const { project, projectRole } = useProjectDashboard()
    const readOnly = projectRole === 'viewer'

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <section className="w-full">
                <MediaAttachmentPicker
                    emptyDescription={m.media_empty_description()}
                    projectId={project.id}
                    inspectAssetId={assetId}
                    onInspectClose={() => {
                        if (assetId) void navigate({ search: {}, replace: true })
                    }}
                    renderHeader={({ disabled, onImport, uploading, view }) => (
                        <DashboardPageHeader
                            back={
                                <Link
                                    aria-label={m.nav_back_to_overview()}
                                    className={buttonVariants({
                                        variant: 'ghost',
                                        size: 'icon',
                                        className:
                                            'justify-self-start text-muted-foreground hover:text-foreground lg:w-auto lg:gap-1.5 lg:px-2.5',
                                    })}
                                    params={{ projectId: project.id }}
                                    to="/dashboard/projects/$projectId/overview">
                                    <AltArrowLeftIcon aria-hidden="true" />
                                    <span className="hidden lg:inline">
                                        {m.nav_back_to_overview()}
                                    </span>
                                </Link>
                            }
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
