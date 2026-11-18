import { Button } from '@postdot/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postdot/ui/components/tooltip'
import { CheckIcon } from '@solar-icons/react/linear/check'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { DownloadMinimalisticIcon } from '@solar-icons/react/linear/download-minimalistic'
import { ShareIcon } from '@solar-icons/react/linear/share'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { MediaPreview, readyRepresentation } from '@/components/media-asset-card'
import { api, type MediaReference, type PublicationEditorState } from '@/lib/api'
import {
    canCopyImages,
    canShareFiles,
    copyImageToClipboard,
    downloadFile,
    fetchAsFile,
    isCopyableImage,
} from '@/lib/manual-publication-media'
import { getTargetPreviewBody, getTargetPreviewTitle } from '@/lib/publication-preview'
import { getTargetMediaSelections } from '@/lib/target-media'
import * as m from '@/paraglide/messages.js'

import { useMediaReferences } from './use-media-references'

const COPIED_FEEDBACK_MS = 2_000

/**
 * What a person needs to recreate a manual publication on the platform: the channel's own
 * title, text and media, each one action away. It reads the same channel document as the
 * preview, so what is copied is what the preview shows.
 */
export function ManualPublicationKit({
    editor,
    content,
    locked,
}: {
    readonly editor: PublicationEditorState
    readonly content: Readonly<Record<string, unknown>>
    readonly locked: boolean
}) {
    const profile = locked
        ? (editor.selectedTargetProfile ?? editor.profile).profile
        : editor.profile.profile
    const projectId = editor.publication.projectId
    const title = getTargetPreviewTitle(profile, content).trim()
    const text = getTargetPreviewBody(profile, content)
    const selections = getTargetMediaSelections(profile, { ...content })
    const references = useMediaReferences(
        projectId,
        selections.map(selection => selection.assetId)
    )
    const media = selections.flatMap(selection => {
        const reference = references.find(item => item.asset.id === selection.assetId)
        return reference ? [{ selection, reference }] : []
    })
    const [feedback, setFeedback] = useState<{ key: string; ok: boolean } | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])
    const imagesCopyable = canCopyImages()
    const shareable = canShareFiles() && media.length > 0

    async function attempt(key: string, action: () => Promise<void>) {
        clearTimeout(timer.current)
        try {
            await action()
            setFeedback({ key, ok: true })
        } catch {
            setFeedback({ key, ok: false })
        }
        timer.current = setTimeout(() => setFeedback(null), COPIED_FEEDBACK_MS)
    }

    function contentUrl(reference: MediaReference) {
        return api.mediaContentUrl(projectId, reference.asset.id)
    }

    function downloadAll() {
        for (const { reference } of media) {
            downloadFile(contentUrl(reference), reference.asset.originalFilename)
        }
    }

    async function share() {
        const files = await Promise.all(
            media.map(({ reference }) =>
                fetchAsFile(contentUrl(reference), reference.asset.originalFilename)
            )
        )
        // A share cancelled by the person is not a failure worth telling.
        await navigator
            .share({ files, ...(text ? { text } : {}), ...(title ? { title } : {}) })
            .catch((caught: unknown) => {
                if (caught instanceof DOMException && caught.name === 'AbortError') return
                throw caught
            })
    }

    if (!title && !text && media.length === 0) return null

    const failed = feedback?.ok === false
    return (
        <section
            data-manual-publication-kit="true"
            aria-label={m.manual_kit_title({ channel: editor.channel.name })}
            className="space-y-3 rounded-lg border border-border px-4 py-3">
            <h2 className="text-sm font-semibold">
                {m.manual_kit_title({ channel: editor.channel.name })}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
                {title ? (
                    <KitButton
                        action="copy-title"
                        done={feedback?.key === 'title' && feedback.ok}
                        onClick={() =>
                            void attempt('title', () => navigator.clipboard.writeText(title))
                        }>
                        {m.manual_kit_copy_title()}
                    </KitButton>
                ) : null}
                {text ? (
                    <KitButton
                        action="copy-text"
                        done={feedback?.key === 'text' && feedback.ok}
                        onClick={() =>
                            void attempt('text', () => navigator.clipboard.writeText(text))
                        }>
                        {m.manual_kit_copy_text()}
                    </KitButton>
                ) : null}
                {media.length > 1 ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-manual-kit-action="download-all"
                        onClick={downloadAll}>
                        <DownloadMinimalisticIcon aria-hidden="true" />
                        {m.manual_kit_download_all({ count: media.length })}
                    </Button>
                ) : null}
                {shareable ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-manual-kit-action="share"
                        onClick={() => void attempt('share', share)}>
                        <ShareIcon aria-hidden="true" />
                        {m.manual_kit_share()}
                    </Button>
                ) : null}
            </div>
            {media.length > 0 ? (
                <ul className="flex flex-wrap gap-3" data-manual-kit-media="true">
                    {media.map(({ selection, reference }, index) => {
                        const representation = readyRepresentation(reference)
                        const contentType =
                            representation?.detectedContentType ??
                            representation?.declaredContentType
                        const name = reference.asset.originalFilename
                        const description =
                            selection.accessibilityText?.trim() ||
                            reference.asset.defaultAccessibilityText?.trim() ||
                            ''
                        const key = `media:${selection.assetId}:${index}`
                        return (
                            <li
                                key={key}
                                className="flex w-24 flex-col gap-1.5"
                                data-manual-kit-item={selection.assetId}>
                                <MediaPreview
                                    projectId={projectId}
                                    asset={reference}
                                    representation={representation}
                                    alt={description || name}
                                    className="aspect-square w-24 rounded-md border border-border object-cover"
                                />
                                <div className="flex items-center gap-0.5">
                                    {imagesCopyable && isCopyableImage(contentType) ? (
                                        <KitIconButton
                                            label={m.manual_kit_copy_image({ name })}
                                            action="copy-image"
                                            done={feedback?.key === `${key}:image` && feedback.ok}
                                            onClick={() =>
                                                void attempt(`${key}:image`, () =>
                                                    copyImageToClipboard(contentUrl(reference))
                                                )
                                            }>
                                            <CopyIcon aria-hidden="true" />
                                        </KitIconButton>
                                    ) : null}
                                    <KitIconButton
                                        label={m.manual_kit_download_media({ name })}
                                        action="download"
                                        onClick={() => downloadFile(contentUrl(reference), name)}>
                                        <DownloadMinimalisticIcon aria-hidden="true" />
                                    </KitIconButton>
                                    {description ? (
                                        <KitIconButton
                                            label={m.manual_kit_copy_description({ name })}
                                            action="copy-description"
                                            done={
                                                feedback?.key === `${key}:description` &&
                                                feedback.ok
                                            }
                                            onClick={() =>
                                                void attempt(`${key}:description`, () =>
                                                    navigator.clipboard.writeText(description)
                                                )
                                            }>
                                            <span
                                                aria-hidden="true"
                                                className="text-[0.625rem] font-semibold">
                                                {m.media_accessibility_badge()}
                                            </span>
                                        </KitIconButton>
                                    ) : null}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            ) : null}
            <p role="status" className={failed ? 'text-xs text-state-failed' : 'sr-only'}>
                {feedback === null
                    ? ''
                    : feedback.ok
                      ? m.manual_kit_copied()
                      : m.manual_kit_failed()}
            </p>
        </section>
    )
}

function KitButton({
    action,
    children,
    done,
    onClick,
}: {
    readonly action: string
    readonly children: ReactNode
    readonly done: boolean
    readonly onClick: () => void
}) {
    return (
        <Button
            type="button"
            size="sm"
            variant="secondary"
            data-manual-kit-action={action}
            onClick={onClick}>
            {done ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {children}
        </Button>
    )
}

function KitIconButton({
    action,
    children,
    done = false,
    label,
    onClick,
}: {
    readonly action: string
    readonly children: ReactNode
    readonly done?: boolean
    readonly label: string
    readonly onClick: () => void
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={label}
                        data-manual-kit-action={action}
                        onClick={onClick}
                    />
                }>
                {done ? <CheckIcon aria-hidden="true" /> : children}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}
