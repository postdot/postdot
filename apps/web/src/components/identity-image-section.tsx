import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postdot/ui/components/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { ChannelAvatar, ResourceAvatar } from '@/components/identity-visuals'
import { ApiError, formatApiError } from '@/lib/api'
import {
    changeIdentityImage,
    setIdentityWebsite,
    type IdentityImageChange,
    type IdentityTarget,
} from '@/lib/identity-image-api'
import { projectQueryKeys } from '@/lib/project-realtime'
import * as m from '@/paraglide/messages.js'

type IdentityResource = {
    readonly id: string
    readonly name: string
    readonly websiteUrl?: string | null
    readonly imageUrl?: string | null
    readonly revision?: number
    readonly profileId?: string
}
export interface IdentityImageEditorHandle {
    save(): Promise<IdentityResource>
}

/** Stages changes until the settings page or enclosing channel dialog saves once. */
export function IdentityImageSection({
    target,
    resource,
    disabled = false,
    embedded = false,
    editorRef,
    onRefusal,
}: {
    readonly target: IdentityTarget
    readonly resource: IdentityResource
    readonly disabled?: boolean
    readonly embedded?: boolean
    readonly editorRef?: Ref<IdentityImageEditorHandle>
    readonly onRefusal?: (error: unknown) => void
}) {
    const id = useId()
    const router = useRouter()
    const queryClient = useQueryClient()
    const fileInput = useRef<HTMLInputElement>(null)
    const [saved, setSaved] = useState(resource)
    const [website, setWebsite] = useState(resource.websiteUrl ?? '')
    const [change, setChange] = useState<IdentityImageChange | null>(null)
    const [filePreview, setFilePreview] = useState<string | null>(null)
    const [urlOpen, setUrlOpen] = useState(false)
    const [imageUrl, setImageUrl] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [warning, setWarning] = useState<string | null>(null)
    const dirty = website.trim() !== (saved.websiteUrl ?? '') || change !== null

    useEffect(() => {
        if (
            !dirty &&
            !pending &&
            (resource.revision === undefined ||
                saved.revision === undefined ||
                resource.revision >= saved.revision) &&
            (resource.imageUrl !== saved.imageUrl ||
                resource.websiteUrl !== saved.websiteUrl ||
                resource.revision !== saved.revision)
        ) {
            setSaved(resource)
            setWebsite(resource.websiteUrl ?? '')
        }
    }, [resource, saved, dirty, pending])

    useEffect(() => {
        if (change?.kind !== 'upload') {
            setFilePreview(null)
            return
        }
        const url = URL.createObjectURL(change.file)
        setFilePreview(url)
        return () => URL.revokeObjectURL(url)
    }, [change])

    function report(error: unknown) {
        onRefusal?.(error)
        setError(identityError(error))
    }
    async function save(): Promise<IdentityResource> {
        if (disabled || pending) throw new Error('Identity image editing is unavailable')
        if (!dirty) return saved
        setPending(true)
        setError(null)
        setWarning(null)
        let current = saved
        try {
            if (website.trim() !== (current.websiteUrl ?? '')) {
                current = await setIdentityWebsite(target, website.trim() || null, current.revision)
                setSaved(current)
                setWebsite(current.websiteUrl ?? '')
                if (website.trim() && !current.imageUrl) setWarning(m.identity_icon_unavailable())
            }
            if (change) {
                current = await changeIdentityImage(target, change, current.revision)
                setSaved(current)
                setChange(null)
            }
            if (target.kind === 'channel')
                await queryClient.invalidateQueries({
                    queryKey: projectQueryKeys.channels(target.projectId),
                })
            await queryClient.invalidateQueries({
                queryKey:
                    target.kind === 'channel'
                        ? ['workspace-channels']
                        : ['resource-impact', target.kind, target.id],
            })
            await router.invalidate()
            return current
        } catch (error) {
            report(error)
            throw error
        } finally {
            setPending(false)
        }
    }
    useImperativeHandle(editorRef, () => ({ save }))
    const preview = change?.kind === 'remove' ? null : (filePreview ?? saved.imageUrl)
    const busy = disabled || pending
    return (
        <section className="space-y-4" aria-labelledby={`${id}-title`}>
            <h2 id={`${id}-title`} className="font-heading text-lg font-medium">
                {m.identity_image()}
            </h2>
            <div className="flex items-center gap-4">
                {target.kind === 'channel' ? (
                    <ChannelAvatar
                        size="lg"
                        channel={{
                            id: resource.id,
                            name: resource.name,
                            profileId: resource.profileId ?? 'manual-message',
                            imageUrl: preview,
                        }}
                    />
                ) : (
                    <ResourceAvatar
                        kind={target.kind}
                        name={resource.name}
                        seed={resource.id}
                        size="lg"
                        imageUrl={preview}
                    />
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button type="button" variant="outline" size="sm" disabled={busy} />
                        }>
                        {m.identity_change_image()}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                            {m.identity_upload()}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setUrlOpen(true)}>
                            {m.identity_from_url()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!website.trim()}
                            onClick={() => {
                                setChange({ kind: 'favicon' })
                                setError(null)
                            }}>
                            {m.identity_use_icon()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => {
                                setChange({ kind: 'remove' })
                                setError(null)
                            }}>
                            {m.identity_remove()}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <input
                    ref={fileInput}
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon"
                    tabIndex={-1}
                    aria-label={m.identity_upload()}
                    onChange={event => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (!file) return
                        if (file.size > 2 * 1024 * 1024) {
                            setError(m.identity_error_size())
                            return
                        }
                        setChange({ kind: 'upload', file })
                        setError(null)
                    }}
                />
            </div>
            {change && change.kind !== 'upload' ? (
                <p role="status" className="text-sm text-muted-foreground">
                    {change.kind === 'url'
                        ? m.identity_url_selected()
                        : change.kind === 'favicon'
                          ? m.identity_icon_selected()
                          : m.identity_remove_selected()}
                </p>
            ) : null}
            <Field>
                <FieldLabel htmlFor={`${id}-website`}>{m.identity_website()}</FieldLabel>
                <Input
                    id={`${id}-website`}
                    type="url"
                    value={website}
                    disabled={busy}
                    onChange={event => setWebsite(event.target.value)}
                />
            </Field>
            {error ? (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            ) : null}
            {warning ? (
                <p role="status" className="text-sm text-muted-foreground">
                    {warning}
                </p>
            ) : null}
            {!embedded ? (
                <Button
                    type="button"
                    disabled={busy || !dirty}
                    onClick={() => void save().catch(() => {})}>
                    {m.common_save()}
                </Button>
            ) : null}
            <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.identity_from_url()}</DialogTitle>
                    </DialogHeader>
                    <Field>
                        <FieldLabel htmlFor={`${id}-url`}>{m.identity_image_url()}</FieldLabel>
                        <Input
                            id={`${id}-url`}
                            type="url"
                            value={imageUrl}
                            onChange={event => setImageUrl(event.target.value)}
                        />
                    </Field>
                    <DialogFooter>
                        <Button
                            type="button"
                            disabled={!/^https?:\/\//i.test(imageUrl.trim())}
                            onClick={() => {
                                setChange({ kind: 'url', url: imageUrl.trim() })
                                setUrlOpen(false)
                                setError(null)
                            }}>
                            {m.identity_choose()}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    )
}

function identityError(error: unknown) {
    if (!(error instanceof ApiError)) return m.identity_error_remote()
    if (error.code === 'identity_image_size') return m.identity_error_size()
    if (error.code === 'identity_image_format' || error.code === 'identity_image_empty')
        return m.identity_error_format()
    if (error.code === 'identity_network_policy_denied') return m.identity_error_network()
    if (error.code === 'identity_website_invalid' || error.code === 'identity_image_url_invalid')
        return m.identity_error_url()
    if (error.code.startsWith('identity_')) return m.identity_error_remote()
    return formatApiError(error)
}
