import { Button } from '@herald/ui/components/button'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'

import { api, type MediaReference } from '@/lib/api'
import { formatBytes, formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

interface MediaAssetCardProps {
    readonly asset: MediaReference
    readonly interactionDisabled: boolean
    readonly layout?: MediaAssetCardLayout
    readonly projectId: string
    readonly selected: MediaSelection | undefined
    readonly selectable?: boolean
    readonly actionSelectionEnabled?: boolean
    readonly actionSelected?: boolean
    readonly onAccessibilityTextChange: (assetId: string, text: string) => void
    readonly onActionSelectionToggle?: (asset: MediaReference) => void
    readonly onOpen?: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
    readonly onToggle: (asset: MediaReference) => void
    readonly onPreview: (asset: MediaReference) => void
}

export type MediaAssetCardLayout = 'grid' | 'compact' | 'list'

export function MediaAssetCard({
    asset,
    interactionDisabled,
    layout = 'list',
    projectId,
    selected,
    selectable = true,
    actionSelectionEnabled = false,
    actionSelected = false,
    onAccessibilityTextChange,
    onActionSelectionToggle,
    onOpen,
    onRequestDelete,
    onToggle,
    onPreview,
}: MediaAssetCardProps) {
    const { locale } = useLanguage()
    const representation = readyRepresentation(asset)
    const isGrid = layout === 'grid'
    const isCompact = layout === 'compact'
    const attachmentSelected = selectable && selected !== undefined
    const previewClassName = isGrid
        ? 'flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground object-cover'
        : isCompact
          ? 'flex size-12 items-center justify-center rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground object-cover'
          : 'flex size-20 items-center justify-center rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground object-cover'

    return (
        <article
            data-media-card-layout={layout}
            data-media-bulk-selection-card={
                actionSelectionEnabled || onOpen !== undefined ? 'true' : undefined
            }
            data-media-action-selected={actionSelected || undefined}
            onClick={event => {
                if (interactionDisabled || asset.asset.state !== 'ready') return
                if (
                    event.target instanceof Element &&
                    event.target.closest('button, input, textarea, a, select') !== null
                ) {
                    return
                }
                if (actionSelectionEnabled) {
                    onActionSelectionToggle?.(asset)
                } else {
                    onOpen?.(asset)
                }
            }}
            className={`group relative rounded-md bg-surface-field ${isGrid || isCompact ? 'p-2' : 'p-3'} shadow-field transition-[background-color,box-shadow] ${
                actionSelected
                    ? 'cursor-pointer bg-primary/5 ring-1 ring-primary/75'
                    : attachmentSelected
                      ? 'ring-2 ring-foreground/25'
                      : (actionSelectionEnabled || onOpen !== undefined) &&
                          asset.asset.state === 'ready'
                        ? 'cursor-pointer'
                        : ''
            }`}>
            <div
                className={
                    isGrid ? 'flex min-w-0 flex-col gap-2' : 'flex min-w-0 items-center gap-3'
                }>
                {actionSelectionEnabled ? (
                    <div
                        data-media-preview="true"
                        className={`${isGrid ? 'block w-full' : 'shrink-0'} cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                        <MediaPreview
                            projectId={projectId}
                            asset={asset}
                            representation={representation}
                            className={previewClassName}
                        />
                    </div>
                ) : (
                    <button
                        type="button"
                        disabled={interactionDisabled || representation === undefined}
                        aria-label={m.media_view_asset({ filename: asset.asset.originalFilename })}
                        data-media-preview="true"
                        onClick={() => onPreview(asset)}
                        className={`${isGrid ? 'block w-full' : 'shrink-0'} cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50`}>
                        <MediaPreview
                            projectId={projectId}
                            asset={asset}
                            representation={representation}
                            className={previewClassName}
                        />
                    </button>
                )}
                {actionSelectionEnabled ? (
                    <button
                        type="button"
                        aria-label={
                            actionSelected
                                ? m.media_bulk_deselect_asset({
                                      filename: asset.asset.originalFilename,
                                  })
                                : m.media_bulk_select_asset({
                                      filename: asset.asset.originalFilename,
                                  })
                        }
                        aria-pressed={actionSelected}
                        data-media-bulk-selection-toggle="true"
                        disabled={
                            interactionDisabled ||
                            asset.asset.state !== 'ready' ||
                            onActionSelectionToggle === undefined
                        }
                        onClick={() => onActionSelectionToggle?.(asset)}
                        className={`flex min-w-0 flex-1 cursor-pointer gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isGrid ? 'items-start' : 'items-center'}`}>
                        <AssetDetails
                            asset={asset}
                            locale={locale}
                            representation={representation}
                        />
                    </button>
                ) : selectable ? (
                    <button
                        type="button"
                        aria-pressed={selected !== undefined}
                        data-media-selection-toggle="true"
                        disabled={interactionDisabled || asset.asset.state !== 'ready'}
                        onClick={() => onToggle(asset)}
                        className={`flex min-w-0 flex-1 gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${isGrid ? 'items-start' : 'items-center'}`}>
                        <AssetDetails
                            asset={asset}
                            locale={locale}
                            representation={representation}
                        />
                        {selected === undefined ? (
                            <span className="text-xs text-muted-foreground">
                                {m.media_attach()}
                            </span>
                        ) : (
                            <CheckReadIcon
                                aria-label={m.media_attached()}
                                className="shrink-0 text-primary"
                            />
                        )}
                    </button>
                ) : (
                    <div className="min-w-0 flex-1">
                        <AssetDetails
                            asset={asset}
                            locale={locale}
                            representation={representation}
                        />
                    </div>
                )}
            </div>
            {onRequestDelete !== undefined ? (
                <div className="absolute top-1 right-1 z-10 flex gap-1 pointer-events-auto opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={interactionDisabled}
                        data-media-delete-trigger="true"
                        aria-label={m.media_delete_asset({
                            filename: asset.asset.originalFilename,
                        })}
                        title={m.media_delete_asset({ filename: asset.asset.originalFilename })}
                        className="pointer-events-auto text-state-failed hover:bg-state-failed/10 hover:text-state-failed"
                        onClick={() => onRequestDelete(asset)}>
                        <TrashBinMinimalisticIcon aria-hidden="true" />
                    </Button>
                </div>
            ) : null}
            {selectable && selected !== undefined ? (
                <Field className="mt-3 gap-1">
                    <FieldLabel className="text-xs" htmlFor={`media-alt-${asset.asset.id}`}>
                        {m.media_accessibility_text()}
                    </FieldLabel>
                    <Input
                        id={`media-alt-${asset.asset.id}`}
                        value={selected.accessibilityText ?? ''}
                        disabled={interactionDisabled}
                        onChange={event =>
                            onAccessibilityTextChange(asset.asset.id, event.target.value)
                        }
                        placeholder={m.media_accessibility_placeholder()}
                        className="h-8 text-xs"
                    />
                </Field>
            ) : null}
        </article>
    )
}

function AssetDetails({
    asset,
    locale,
    representation,
}: {
    readonly asset: MediaReference
    readonly locale: string
    readonly representation: ReturnType<typeof readyRepresentation>
}) {
    return (
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
                {asset.asset.originalFilename}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
                {mediaSummary(asset, representation, locale)}
            </span>
        </span>
    )
}

export function readyRepresentation(asset: MediaReference) {
    return (
        asset.representations.find(
            representation => representation.state === 'ready' && representation.kind === 'original'
        ) ?? asset.representations.find(representation => representation.state === 'ready')
    )
}

function mediaSummary(
    asset: MediaReference,
    representation: ReturnType<typeof readyRepresentation>,
    locale: string
) {
    const details = [representation?.detectedContentType ?? representation?.declaredContentType]
    if (representation?.byteSize !== null && representation?.byteSize !== undefined) {
        details.push(formatBytes(representation.byteSize, locale))
    }
    if (
        representation !== undefined &&
        representation.width !== null &&
        representation.height !== null
    ) {
        details.push(
            `${formatNumber(representation.width, locale)}×${formatNumber(representation.height, locale)}`
        )
    }
    if (asset.asset.state !== 'ready') details.push(mediaStateLabel(asset.asset.state))
    return details
        .filter((detail): detail is string => detail !== null && detail !== undefined)
        .join(' · ')
}

export function MediaPreview({
    projectId,
    asset,
    representation,
    className,
}: {
    readonly projectId: string
    readonly asset: MediaReference
    readonly representation: ReturnType<typeof readyRepresentation>
    readonly className?: string
}) {
    if (representation?.family === 'image') {
        return (
            <img
                src={api.mediaContentUrl(projectId, asset.asset.id)}
                alt=""
                loading="lazy"
                className={className ?? 'size-12 rounded-md object-cover shadow-field'}
            />
        )
    }
    return (
        <span
            className={
                className ??
                'flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground shadow-field'
            }>
            {representation?.family?.slice(0, 3) ?? m.media_file_type()}
        </span>
    )
}

function mediaStateLabel(state: MediaReference['asset']['state']) {
    switch (state) {
        case 'reserved':
            return m.media_state_reserved()
        case 'stored':
            return m.media_state_stored()
        case 'inspecting':
            return m.media_state_inspecting()
        case 'ready':
            return m.media_state_ready()
        case 'failed':
            return m.media_state_failed()
        case 'deletion_requested':
            return m.media_state_deletion_requested()
        case 'deleted':
            return m.media_state_deleted()
        default:
            return m.media_state_unknown()
    }
}
