import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { CloseIcon } from '@solar-icons/react/linear/close'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'

import { ActionTooltip } from '@/components/action-tooltip'
import { publicationStateLabel } from '@/components/dashboard-publication-parts'
import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, type MediaAssetUsage, type MediaReference } from '@/lib/api'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function MediaInformationDialog({
    asset,
    onOpenChange,
    open,
}: {
    readonly asset: MediaReference | null
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
}) {
    const { locale } = useLanguage()
    const [usage, setUsage] = useState<MediaAssetUsage | null>(null)
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState(false)

    useEffect(() => {
        if (!open || asset === null) {
            setUsage(null)
            setUsageLoading(false)
            setUsageError(false)
            return
        }

        let active = true
        setUsage(null)
        setUsageLoading(true)
        setUsageError(false)
        void api
            .getMediaUsage(asset.asset.projectId, asset.asset.id)
            .then(result => {
                if (active) setUsage(result)
            })
            .catch(() => {
                if (active) setUsageError(true)
            })
            .finally(() => {
                if (active) setUsageLoading(false)
            })

        return () => {
            active = false
        }
    }, [asset?.asset.id, asset?.asset.projectId, open])

    if (asset === null) return null

    const representation = readyRepresentation(asset)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const dimensions =
        representation?.width !== null &&
        representation?.width !== undefined &&
        representation.height !== null &&
        representation.height !== undefined
            ? `${formatNumber(representation.width, locale)} × ${formatNumber(representation.height, locale)}`
            : null
    const contentType =
        representation?.detectedContentType ?? representation?.declaredContentType ?? null
    const format = (
        representation?.detectedFormat ??
        contentType?.split('/')[1] ??
        null
    )?.toUpperCase()
    const hasAccessibilityText =
        asset.asset.defaultAccessibilityText !== null &&
        asset.asset.defaultAccessibilityText.trim() !== ''
    const hasTechnicalDetails =
        representation !== undefined &&
        (representation.durationMs !== null ||
            representation.pageCount !== null ||
            representation.isAnimated !== null)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                data-media-info-dialog="true"
                className="max-h-[min(46rem,calc(100dvh-2rem))] gap-0 overflow-hidden bg-surface-raised p-0 sm:max-w-3xl">
                <DialogHeader className="px-5 pt-5 pb-3 sm:px-6">
                    <DialogTitle className="flex min-w-0 items-center gap-2 pr-8">
                        {m.media_info_title()}
                    </DialogTitle>
                    <DialogDescription className="truncate">
                        {asset.asset.originalFilename}
                    </DialogDescription>
                </DialogHeader>
                <ActionTooltip label={m.common_close()}>
                    <DialogClose
                        render={
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={m.common_close()}
                                className="absolute top-2 right-2"
                            />
                        }>
                        <CloseIcon aria-hidden="true" />
                    </DialogClose>
                </ActionTooltip>

                <div
                    data-media-info-body="true"
                    className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
                    <div className="grid gap-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                        <div
                            data-media-info-preview="true"
                            className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg bg-surface-inset sm:min-h-72">
                            <MediaPreview
                                variant="preview"
                                projectId={asset.asset.projectId}
                                asset={asset}
                                representation={representation}
                                className="flex size-full items-center justify-center object-contain text-xs font-medium text-muted-foreground"
                            />
                        </div>

                        <section aria-labelledby="media-info-details" className="min-w-0">
                            <h2 id="media-info-details" className="text-sm font-medium">
                                {m.media_info_details()}
                            </h2>
                            <dl className="mt-4 grid gap-2.5">
                                <InfoRow label={m.media_info_type()} value={contentType ?? '—'} />
                                <InfoRow label={m.media_info_format()} value={format ?? '—'} />
                                <InfoRow
                                    label={m.media_info_size()}
                                    value={
                                        representation?.byteSize === null ||
                                        representation?.byteSize === undefined
                                            ? '—'
                                            : formatBytes(representation.byteSize, locale)
                                    }
                                />
                                {dimensions !== null ? (
                                    <InfoRow label={m.media_info_dimensions()} value={dimensions} />
                                ) : null}
                                {hasTechnicalDetails ? (
                                    <TechnicalInfoRows
                                        representation={representation}
                                        locale={locale}
                                    />
                                ) : null}
                                <InfoRow
                                    label={m.media_info_created()}
                                    value={formatDateTime(asset.asset.createdAt, timeZone, locale)}
                                />
                                <InfoRow
                                    label={m.media_info_updated()}
                                    value={formatDateTime(asset.asset.updatedAt, timeZone, locale)}
                                />
                                {hasAccessibilityText ? (
                                    <InfoRow
                                        label={m.media_accessibility_text()}
                                        value={asset.asset.defaultAccessibilityText ?? '—'}
                                    />
                                ) : null}
                            </dl>
                        </section>
                    </div>

                    <MediaUsageSection
                        asset={asset}
                        usage={usage}
                        usageError={usageError}
                        usageLoading={usageLoading}
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}

function InfoRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
    return (
        <div className="grid min-w-0 grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] items-start gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-right">{value}</dd>
        </div>
    )
}

function TechnicalInfoRows({
    locale,
    representation,
}: {
    readonly locale: string
    readonly representation: ReturnType<typeof readyRepresentation>
}) {
    if (representation === undefined) return null

    return (
        <>
            {representation.durationMs !== null ? (
                <InfoRow
                    label={m.media_info_duration()}
                    value={formatDuration(representation.durationMs, locale)}
                />
            ) : null}
            {representation.pageCount !== null ? (
                <InfoRow
                    label={m.media_info_pages()}
                    value={formatNumber(representation.pageCount, locale)}
                />
            ) : null}
            {representation.isAnimated !== null ? (
                <InfoRow
                    label={m.media_info_animation()}
                    value={representation.isAnimated ? m.media_info_yes() : m.media_info_no()}
                />
            ) : null}
        </>
    )
}

function MediaUsageSection({
    asset,
    usage,
    usageError,
    usageLoading,
}: {
    readonly asset: MediaReference
    readonly usage: MediaAssetUsage | null
    readonly usageError: boolean
    readonly usageLoading: boolean
}) {
    const hasUsage =
        usage !== null &&
        (usage.active.length > 0 || usage.history.length > 0 || usage.auditEventCount > 0)

    return (
        <section
            aria-labelledby="media-info-usage"
            data-media-info-usage="true"
            className="mt-7 pb-2">
            <h2 id="media-info-usage" className="text-sm font-medium">
                {m.media_info_usage()}
            </h2>

            {usageLoading ? (
                <p aria-busy="true" className="mt-3 text-sm text-muted-foreground">
                    {m.media_info_usage_loading()}
                </p>
            ) : usageError ? (
                <p role="alert" className="mt-3 text-sm text-state-attention">
                    {m.media_info_usage_error()}
                </p>
            ) : usage === null ? null : !hasUsage ? (
                <p className="mt-3 text-sm text-muted-foreground">{m.media_info_usage_none()}</p>
            ) : (
                <div className="mt-3 grid gap-4">
                    {usage.active.length > 0 ? (
                        <UsageGroup
                            asset={asset}
                            references={usage.active}
                            title={m.media_info_usage_active()}
                        />
                    ) : null}
                    {usage.history.length > 0 ? (
                        <UsageGroup
                            asset={asset}
                            references={usage.history}
                            title={m.media_info_usage_history()}
                        />
                    ) : null}
                    {usage.auditEventCount > 0 ? (
                        <p className="text-xs text-muted-foreground">
                            {m.media_usage_audit({ count: usage.auditEventCount })}
                        </p>
                    ) : null}
                </div>
            )}
        </section>
    )
}

function UsageGroup({
    asset,
    references,
    title,
}: {
    readonly asset: MediaReference
    readonly references: MediaAssetUsage['active']
    readonly title: string
}) {
    return (
        <div className="grid gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
            <ul className="grid gap-2">
                {references.map(reference => (
                    <UsageReference
                        key={`${reference.kind}:${reference.id}`}
                        asset={asset}
                        reference={reference}
                    />
                ))}
            </ul>
        </div>
    )
}

function UsageReference({
    asset,
    reference,
}: {
    readonly asset: MediaReference
    readonly reference: MediaAssetUsage['active'][number]
}) {
    const title = reference.title ?? m.media_info_untitled()
    const context =
        reference.kind === 'post'
            ? m.media_info_usage_source()
            : (reference.channelName ?? m.media_info_usage_publication())
    const state =
        reference.publicationState === null
            ? null
            : publicationStateLabel(reference.publicationState)
    const locations = reference.locations.map(mediaUsageLocationLabel).join(' · ')

    const content = (
        <>
            <div className="flex min-w-0 items-start justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{title}</span>
                {reference.publicationId !== null ? (
                    <AltArrowRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                ) : null}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
                {context}
                {state === null ? '' : ` · ${state}`}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <LinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {locations}
            </p>
        </>
    )

    return (
        <li className="min-w-0 rounded-md bg-surface-field px-3 py-2.5 shadow-field">
            {reference.publicationId !== null ? (
                <Link
                    to="/dashboard/projects/$projectId/publications/$publicationId"
                    params={{
                        projectId: asset.asset.projectId,
                        publicationId: reference.publicationId,
                    }}
                    className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {content}
                </Link>
            ) : (
                content
            )}
        </li>
    )
}

function mediaUsageLocationLabel(location: MediaAssetUsage['active'][number]['locations'][number]) {
    switch (location) {
        case 'source':
            return m.media_info_usage_source()
        case 'draft':
            return m.media_info_usage_draft()
        case 'target':
            return m.media_info_usage_target()
        case 'execution':
            return m.media_info_usage_execution()
    }
}

function formatDuration(durationMs: number, locale: string) {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
    const hours = Math.floor(totalSeconds / 3_600)
    const minutes = Math.floor((totalSeconds % 3_600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) {
        return `${formatNumber(hours, locale)}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
    return `${formatNumber(minutes, locale)}:${String(seconds).padStart(2, '0')}`
}
