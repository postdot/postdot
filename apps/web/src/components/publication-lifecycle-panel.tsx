import { Button } from '@herald/ui/components/button'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'

import { formatSchedule, PublicationStatus } from '@/components/dashboard-publication-parts'
import type { Publication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { isManualPublicationDue } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export function PublicationLifecyclePanel({
    cancelDisabled = false,
    onCancel,
    onPublish,
    onRetry,
    pending = false,
    publication,
    retryDisabled = false,
    timeZone,
}: {
    readonly cancelDisabled?: boolean
    readonly onCancel?: () => void
    readonly onPublish?: () => Promise<boolean>
    readonly onRetry?: () => void | Promise<unknown>
    readonly pending?: boolean
    readonly publication: Publication
    readonly retryDisabled?: boolean
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const due = isManualPublicationDue(publication)
    const showManualAction = due && onPublish !== undefined
    const showCancelAction = publication.state === 'scheduled' && onCancel !== undefined
    const showRetryAction =
        publication.state === 'failed' &&
        publication.deliveryMode === 'automatic' &&
        onRetry !== undefined
    const hasAction = showManualAction || showRetryAction || showCancelAction

    return (
        <>
            <div
                data-publication-lifecycle="true"
                className={
                    hasAction
                        ? 'mb-5 flex flex-col items-stretch gap-3 rounded-xl bg-surface-inset/70 px-4 py-3 shadow-surface sm:flex-row sm:items-center sm:justify-between'
                        : 'mb-5 flex flex-wrap items-center gap-3'
                }>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <PublicationStatus due={due} state={publication.state} />
                        {publication.scheduledAt !== null ? (
                            <span className="text-xs text-muted-foreground">
                                {formatSchedule(publication.scheduledAt, timeZone, locale)}
                            </span>
                        ) : null}
                    </div>
                    {publication.state === 'failed' && publication.errorMessage ? (
                        <p
                            className="mt-1.5 max-w-2xl break-words text-xs text-state-failed"
                            data-publication-error="true">
                            {publication.errorMessage}
                        </p>
                    ) : null}
                </div>
                {hasAction ? (
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {showRetryAction ? (
                            <Button
                                data-publication-action="retry"
                                disabled={pending || retryDisabled}
                                onClick={onRetry}
                                size="sm">
                                <RestartIcon aria-hidden="true" />
                                {m.publication_retry_delivery()}
                            </Button>
                        ) : null}
                        {showManualAction ? (
                            <Button
                                data-publication-action="record-published"
                                disabled={pending}
                                onClick={() => void onPublish()}
                                size="sm">
                                <CheckIcon aria-hidden="true" />
                                {m.publication_record_published()}
                            </Button>
                        ) : null}
                        {showCancelAction ? (
                            <Button
                                data-publication-action="cancel"
                                disabled={pending || cancelDisabled}
                                onClick={onCancel}
                                size="sm"
                                variant="destructive">
                                <TrashBinMinimalisticIcon aria-hidden="true" />
                                {m.publication_cancel_submit()}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </>
    )
}
