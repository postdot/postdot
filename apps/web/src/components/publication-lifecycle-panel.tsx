import { Button } from '@herald/ui/components/button'
import { CheckSquareIcon } from '@solar-icons/react/bold/check-square'

import { formatSchedule, PublicationStatus } from '@/components/dashboard-publication-parts'
import type { Publication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { canEditPublication, isManualPublicationDue } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export function PublicationLifecyclePanel({
    onPublish,
    pending = false,
    publication,
    timeZone,
}: {
    readonly onPublish?: () => Promise<boolean>
    readonly pending?: boolean
    readonly publication: Publication
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const editable = canEditPublication(publication.state)
    const due = isManualPublicationDue(publication)
    const showManualAction = due && onPublish !== undefined

    return (
        <>
            <div
                data-publication-lifecycle="true"
                className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-inset/70 px-4 py-3 shadow-surface">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <PublicationStatus state={publication.state} />
                    <span className="text-xs text-muted-foreground">
                        {formatSchedule(publication.scheduledAt, timeZone, locale)}
                    </span>
                </div>
                {showManualAction ? (
                    <Button
                        disabled={pending}
                        onClick={() => void onPublish()}
                        size="sm"
                        variant="secondary">
                        <CheckSquareIcon aria-hidden="true" />
                        {m.publication_record_published()}
                    </Button>
                ) : null}
            </div>

            {!editable && publication.state !== 'ambiguous' ? (
                <div
                    aria-live="polite"
                    className="mb-5 rounded-lg bg-surface-inset/70 px-4 py-3 shadow-surface"
                    data-publication-read-only="true"
                    role="status">
                    <p className="text-sm font-medium">{m.editor_lifecycle_read_only_title()}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {m.editor_lifecycle_read_only()}
                    </p>
                </div>
            ) : null}
        </>
    )
}
