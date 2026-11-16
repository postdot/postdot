import { Button, buttonVariants } from '@postdot/ui/components/button'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/linear/trash-bin-minimalistic'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { formatSchedule, PublicationStatus } from '@/components/dashboard-publication-parts'
import type { Publication, PublisherConnection } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { isManualPublicationDue } from '@/lib/publication-lifecycle'
import * as m from '@/paraglide/messages.js'

export function PublicationLifecyclePanel({
    cancelDisabled = false,
    connection,
    readOnly = false,
    onCancel,
    onPublish,
    onRetry,
    onUndoPublish,
    otherActions,
    pending = false,
    publication,
    retryDisabled = false,
    timeZone,
}: {
    readonly cancelDisabled?: boolean
    readonly connection?: PublisherConnection | null
    readonly readOnly?: boolean
    readonly onCancel?: () => void
    readonly onPublish?: () => Promise<boolean>
    readonly onRetry?: () => void | Promise<unknown>
    readonly onUndoPublish?: () => void
    /** Quiet actions on this publication (moving it), placed before cancelling. */
    readonly otherActions?: ReactNode
    readonly pending?: boolean
    readonly publication: Publication
    readonly retryDisabled?: boolean
    readonly timeZone: string
}) {
    const { locale } = useLanguage()
    const due = isManualPublicationDue(publication)
    const showManualAction = due && onPublish !== undefined
    const showCancelAction = publication.state === 'scheduled' && onCancel !== undefined
    const showUndoPublishAction =
        publication.state === 'published' &&
        publication.deliveryMode === 'manual' &&
        !readOnly &&
        onUndoPublish !== undefined
    const showRetryAction =
        publication.state === 'failed' &&
        publication.deliveryMode === 'automatic' &&
        onRetry !== undefined
    const needsConnection =
        publication.deliveryMode === 'automatic' &&
        ['draft', 'scheduled', 'ready', 'failed'].includes(publication.state) &&
        connection !== undefined &&
        connection?.state !== 'active'
    const hasAction =
        showManualAction ||
        showRetryAction ||
        showCancelAction ||
        showUndoPublishAction ||
        needsConnection ||
        Boolean(otherActions)

    return (
        <>
            <div
                data-publication-lifecycle="true"
                className={
                    hasAction
                        ? 'mb-5 flex flex-col items-stretch gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
                        : 'mb-5 flex flex-wrap items-center gap-3'
                }>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <PublicationStatus due={due} state={publication.state} />
                        {/* D9: published work shows when it went out, not when it was planned. */}
                        {(publication.state === 'published' && publication.publishedAt !== null
                            ? publication.publishedAt
                            : publication.scheduledAt) !== null ? (
                            <span className="text-xs text-muted-foreground">
                                {formatSchedule(
                                    publication.state === 'published' &&
                                        publication.publishedAt !== null
                                        ? publication.publishedAt
                                        : publication.scheduledAt,
                                    timeZone,
                                    locale
                                )}
                            </span>
                        ) : null}
                    </div>
                    {needsConnection ? (
                        <p
                            data-publication-connection-issue
                            className="mt-1.5 text-sm text-state-attention">
                            {connection === null
                                ? m.publication_connection_missing()
                                : connection?.state === 'revoked'
                                  ? m.publication_connection_revoked()
                                  : m.publication_connection_reconnect()}
                        </p>
                    ) : null}
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
                        {needsConnection ? (
                            <Link
                                data-publication-connection-repair
                                className={buttonVariants({
                                    variant: readOnly ? 'secondary' : 'default',
                                    size: 'sm',
                                })}
                                to="/dashboard/projects/$projectId/channels"
                                params={{ projectId: publication.projectId }}
                                hash={`publisher-connection-${publication.channelId}`}>
                                {readOnly
                                    ? m.nav_channels()
                                    : connection === null
                                      ? m.publication_connect_channel()
                                      : m.publication_reconnect_channel()}
                            </Link>
                        ) : null}
                        {showRetryAction ? (
                            <Button
                                data-publication-action="retry"
                                variant={needsConnection ? 'secondary' : 'default'}
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
                        {showUndoPublishAction ? (
                            <Button
                                data-publication-action="undo-publish"
                                disabled={pending}
                                onClick={onUndoPublish}
                                size="sm"
                                variant="ghost">
                                <RestartIcon aria-hidden="true" />
                                {m.publication_undo_publish()}
                            </Button>
                        ) : null}
                        {otherActions}
                        {showCancelAction ? (
                            <Button
                                data-publication-action="cancel"
                                disabled={pending || cancelDisabled}
                                onClick={onCancel}
                                size="sm"
                                // D4 / ADR-103 §5: a destructive action is never the most prominent.
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                variant="ghost">
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
