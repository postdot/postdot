import { Field, FieldLabel } from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'

import { api, type MediaReference } from '@/lib/api'
import { formatBytes, formatNumber } from '@/lib/format'
import { useLanguage } from '@/lib/i18n'
import type { MediaSelection } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

interface MediaAssetCardProps {
    readonly asset: MediaReference
    readonly interactionDisabled: boolean
    readonly projectId: string
    readonly selected: MediaSelection | undefined
    readonly onAccessibilityTextChange: (assetId: string, text: string) => void
    readonly onToggle: (asset: MediaReference) => void
}

export function MediaAssetCard({
    asset,
    interactionDisabled,
    projectId,
    selected,
    onAccessibilityTextChange,
    onToggle,
}: MediaAssetCardProps) {
    const { locale } = useLanguage()
    const representation = readyRepresentation(asset)

    return (
        <article
            className={`rounded-md bg-surface-field p-3 shadow-field ${
                selected === undefined ? '' : 'ring-2 ring-primary/35'
            }`}>
            <button
                type="button"
                aria-pressed={selected !== undefined}
                disabled={interactionDisabled || asset.asset.state !== 'ready'}
                onClick={() => onToggle(asset)}
                className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50">
                <MediaPreview projectId={projectId} asset={asset} representation={representation} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                        {asset.asset.originalFilename}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                        {mediaSummary(asset, representation, locale)}
                    </span>
                </span>
                {selected === undefined ? (
                    <span className="text-xs text-muted-foreground">{m.media_attach()}</span>
                ) : (
                    <CheckReadIcon
                        aria-label={m.media_attached()}
                        className="shrink-0 text-primary"
                    />
                )}
            </button>
            {selected !== undefined ? (
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

function readyRepresentation(asset: MediaReference) {
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

function MediaPreview({
    projectId,
    asset,
    representation,
}: {
    readonly projectId: string
    readonly asset: MediaReference
    readonly representation: ReturnType<typeof readyRepresentation>
}) {
    if (representation?.family === 'image') {
        return (
            <img
                src={api.mediaContentUrl(projectId, asset.asset.id)}
                alt=""
                loading="lazy"
                className="size-12 rounded-md object-cover shadow-field"
            />
        )
    }
    return (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium uppercase text-muted-foreground shadow-field">
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
