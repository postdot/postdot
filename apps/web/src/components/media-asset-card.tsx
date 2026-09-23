import { Button } from '@herald/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@herald/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { DownloadMinimalisticIcon } from '@solar-icons/react/bold/download-minimalistic'
import { FolderOpenIcon } from '@solar-icons/react/bold/folder-open'
import { GalleryEditIcon } from '@solar-icons/react/bold/gallery-edit'
import { InfoCircleIcon } from '@solar-icons/react/bold/info-circle'
import { MenuDotsIcon } from '@solar-icons/react/bold/menu-dots'
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
    readonly showAccessibilityText?: boolean
    readonly showActions?: boolean
    readonly actionSelectionEnabled?: boolean
    readonly actionSelected?: boolean
    readonly onAccessibilityTextChange?: (assetId: string, text: string) => void
    readonly onActionSelectionToggle?: (asset: MediaReference) => void
    readonly onDownload?: (asset: MediaReference) => void
    readonly onEdit?: (asset: MediaReference) => void
    readonly onInfo?: (asset: MediaReference) => void
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
    showAccessibilityText = true,
    showActions = true,
    actionSelectionEnabled = false,
    actionSelected = false,
    onAccessibilityTextChange,
    onActionSelectionToggle,
    onDownload,
    onEdit,
    onInfo,
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
            data-media-selection-card={selectable ? 'true' : undefined}
            data-media-selection-active={attachmentSelected || undefined}
            data-media-action-selected={actionSelected || undefined}
            style={{
                contentVisibility: 'auto',
                containIntrinsicSize: isGrid ? '0 17rem' : isCompact ? '0 5rem' : '0 7rem',
            }}
            onClick={event => {
                if (interactionDisabled || asset.asset.state !== 'ready') return
                if (
                    event.target instanceof Element &&
                    event.target.closest(
                        'button, input, textarea, a, select, [data-media-asset-action]'
                    ) !== null
                ) {
                    return
                }
                if (actionSelectionEnabled) {
                    onActionSelectionToggle?.(asset)
                } else if (selectable) {
                    onToggle(asset)
                } else {
                    onOpen?.(asset)
                }
            }}
            className={`group relative rounded-md bg-surface-field ${isGrid || isCompact ? 'p-2' : 'p-3'} shadow-field transition-[background-color,box-shadow] ${
                actionSelected
                    ? 'cursor-pointer bg-primary/5 ring-1 ring-primary/75'
                    : attachmentSelected
                      ? 'cursor-pointer bg-primary/5 ring-1 ring-primary/70'
                      : (actionSelectionEnabled || onOpen !== undefined || selectable) &&
                          asset.asset.state === 'ready'
                        ? 'cursor-pointer hover:bg-surface-raised/60'
                        : ''
            }`}>
            <div
                className={
                    isGrid ? 'flex min-w-0 flex-col gap-2' : 'flex min-w-0 items-center gap-3'
                }>
                {actionSelectionEnabled || selectable ? (
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
                        title={m.media_view_asset({ filename: asset.asset.originalFilename })}
                        className={`${isGrid ? 'block w-full' : 'shrink-0'} cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50`}>
                        <MediaPreview
                            projectId={projectId}
                            asset={asset}
                            representation={representation}
                            className={previewClassName}
                        />
                    </button>
                )}
                {actionSelectionEnabled ? (
                    <div className="flex min-w-0 flex-1 items-start gap-2">
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
                        {showActions ? (
                            <MediaAssetActions
                                asset={asset}
                                interactionDisabled={interactionDisabled}
                                onDownload={onDownload}
                                onEdit={onEdit}
                                onInfo={onInfo}
                                onOpen={onOpen}
                                onRequestDelete={onRequestDelete}
                                representation={representation}
                            />
                        ) : null}
                    </div>
                ) : selectable ? (
                    <div
                        className={`flex min-w-0 flex-1 items-start gap-2 ${isGrid ? 'items-start' : 'items-center'}`}>
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
                            {selected !== undefined ? (
                                <span className="sr-only">{m.media_attached()}</span>
                            ) : null}
                        </button>
                        {showActions ? (
                            <MediaAssetActions
                                asset={asset}
                                interactionDisabled={interactionDisabled}
                                onOpen={onOpen}
                                representation={representation}
                            />
                        ) : null}
                    </div>
                ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                        <div className="min-w-0 flex-1">
                            <AssetDetails
                                asset={asset}
                                locale={locale}
                                representation={representation}
                            />
                        </div>
                        {showActions ? (
                            <MediaAssetActions
                                asset={asset}
                                interactionDisabled={interactionDisabled}
                                onDownload={onDownload}
                                onEdit={onEdit}
                                onInfo={onInfo}
                                onOpen={onOpen}
                                onRequestDelete={onRequestDelete}
                                representation={representation}
                            />
                        ) : null}
                    </div>
                )}
            </div>
            {selectable && selected !== undefined && showAccessibilityText ? (
                <Field className="mt-3 gap-1">
                    <FieldLabel className="text-xs" htmlFor={`media-alt-${asset.asset.id}`}>
                        {m.media_accessibility_text()}
                    </FieldLabel>
                    <Input
                        id={`media-alt-${asset.asset.id}`}
                        value={selected.accessibilityText ?? ''}
                        disabled={interactionDisabled}
                        onChange={event =>
                            onAccessibilityTextChange?.(asset.asset.id, event.target.value)
                        }
                        placeholder={m.media_accessibility_placeholder()}
                        className="h-8 text-xs"
                    />
                </Field>
            ) : null}
        </article>
    )
}

function MediaAssetActions({
    asset,
    interactionDisabled,
    onDownload,
    onEdit,
    onInfo,
    onOpen,
    onRequestDelete,
    representation,
}: {
    readonly asset: MediaReference
    readonly interactionDisabled: boolean
    readonly onDownload?: (asset: MediaReference) => void
    readonly onEdit?: (asset: MediaReference) => void
    readonly onInfo?: (asset: MediaReference) => void
    readonly onOpen?: (asset: MediaReference) => void
    readonly onRequestDelete?: (asset: MediaReference) => void
    readonly representation: ReturnType<typeof readyRepresentation>
}) {
    if (
        onOpen === undefined &&
        onDownload === undefined &&
        onEdit === undefined &&
        onInfo === undefined &&
        onRequestDelete === undefined
    )
        return null

    return (
        <div className="shrink-0">
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={interactionDisabled}
                            data-media-asset-actions="true"
                            aria-label={m.media_asset_actions({
                                filename: asset.asset.originalFilename,
                            })}
                            className="text-muted-foreground hover:bg-surface-raised hover:text-foreground">
                            <MenuDotsIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <DropdownMenuContent align="end" className="min-w-44">
                    {onInfo !== undefined ? (
                        <DropdownMenuItem
                            data-media-asset-action="info"
                            disabled={interactionDisabled}
                            onClick={() => onInfo(asset)}>
                            <InfoCircleIcon aria-hidden="true" />
                            {m.media_info_action()}
                        </DropdownMenuItem>
                    ) : null}
                    {onOpen !== undefined ? (
                        <DropdownMenuItem
                            data-media-asset-action="open"
                            disabled={
                                interactionDisabled ||
                                asset.asset.state !== 'ready' ||
                                representation === undefined
                            }
                            onClick={() => onOpen(asset)}>
                            <FolderOpenIcon aria-hidden="true" />
                            {m.media_open_action()}
                        </DropdownMenuItem>
                    ) : null}
                    {onDownload !== undefined ? (
                        <DropdownMenuItem
                            data-media-asset-action="download"
                            disabled={interactionDisabled || asset.asset.state !== 'ready'}
                            onClick={() => onDownload(asset)}>
                            <DownloadMinimalisticIcon aria-hidden="true" />
                            {m.media_download_action()}
                        </DropdownMenuItem>
                    ) : null}
                    {onEdit !== undefined ? (
                        <DropdownMenuItem
                            data-media-asset-action="edit"
                            disabled={
                                interactionDisabled ||
                                asset.asset.state !== 'ready' ||
                                representation?.family !== 'image'
                            }
                            onClick={() => onEdit(asset)}>
                            <GalleryEditIcon aria-hidden="true" />
                            {m.media_edit_image()}
                        </DropdownMenuItem>
                    ) : null}
                    {onRequestDelete !== undefined ? (
                        <>
                            {onOpen !== undefined ||
                            onDownload !== undefined ||
                            onEdit !== undefined ||
                            onInfo !== undefined ? (
                                <DropdownMenuSeparator />
                            ) : null}
                            <DropdownMenuItem
                                data-media-asset-action="delete"
                                variant="destructive"
                                disabled={interactionDisabled || asset.asset.state !== 'ready'}
                                onClick={() => onRequestDelete(asset)}>
                                <TrashBinMinimalisticIcon aria-hidden="true" />
                                {m.media_delete_confirm()}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
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
    draggable,
}: {
    readonly projectId: string
    readonly asset: MediaReference
    readonly representation: ReturnType<typeof readyRepresentation>
    readonly className?: string
    readonly draggable?: boolean
}) {
    if (representation?.family === 'image') {
        return (
            <img
                src={api.mediaContentUrl(projectId, asset.asset.id)}
                alt=""
                loading="lazy"
                draggable={draggable}
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
