import { Button } from '@postbot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@postbot/ui/components/dialog'
import { Field, FieldLabel } from '@postbot/ui/components/field'
import { Input } from '@postbot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postbot/ui/components/select'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { useState } from 'react'

import { ProviderApplicationSelect } from '@/components/provider-application-select'
import type { Channel, LinkedInConnectionDestination, ProviderApplication } from '@/lib/api'
import { useLanguage } from '@/lib/i18n'
import { useConnectionAction } from '@/lib/use-connection-action'
import * as m from '@/paraglide/messages.js'

export function OAuthConnectionDialog({
    channel,
    provider,
    disabled,
    reconnect,
    applications,
    applicationId,
    onApplicationChange,
    onConnect,
}: {
    readonly channel: Channel
    readonly provider: 'LinkedIn' | 'X'
    readonly disabled: boolean
    readonly reconnect: boolean
    readonly applications: readonly ProviderApplication[]
    readonly applicationId?: string
    readonly onApplicationChange: (id: string) => void
    readonly onConnect: (destination?: LinkedInConnectionDestination) => Promise<void>
}) {
    useLanguage()
    const [open, setOpen] = useState(false)
    const [destinationKind, setDestinationKind] = useState('member')
    const [organizationId, setOrganizationId] = useState('')
    const { submitting, error, setError, run } = useConnectionAction()
    const title = reconnect
        ? m.provider_reconnect_title({ provider: channel.name })
        : m.provider_connect_title({ provider: channel.name })

    async function submit() {
        if (disabled || submitting) return
        if (
            provider === 'LinkedIn' &&
            destinationKind === 'organization' &&
            !/^\d+$/.test(organizationId.trim())
        ) {
            setError(m.publisher_organization_required())
            return
        }
        await run(() =>
            onConnect(
                provider === 'LinkedIn' && destinationKind === 'organization'
                    ? { type: 'organization', id: organizationId.trim() }
                    : undefined
            )
        )
    }

    // A redirect with no choice needs no intermediate confirmation dialog.
    if (provider === 'X' && applications.length < 2) {
        return (
            <div className="flex flex-col items-end gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || submitting}
                    onClick={() => void run(() => onConnect())}>
                    <LinkIcon aria-hidden="true" />
                    {reconnect
                        ? m.provider_reconnect_title({ provider })
                        : m.provider_connect_title({ provider })}
                </Button>
                {error ? (
                    <p role="alert" className="max-w-sm text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
            </div>
        )
    }

    return (
        <>
            <Button
                className="self-end sm:self-start"
                size="sm"
                variant="outline"
                disabled={disabled || submitting}
                onClick={() => setOpen(true)}>
                <LinkIcon aria-hidden="true" />
                {reconnect
                    ? m.provider_reconnect_title({ provider })
                    : m.provider_connect_title({ provider })}
            </Button>
            <Dialog
                open={open}
                onOpenChange={next => {
                    if (submitting) return
                    setOpen(next)
                    if (!next) {
                        setError(null)
                        setOrganizationId('')
                        setDestinationKind('member')
                    }
                }}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto bg-background sm:max-w-sm">
                    <form
                        className="grid gap-4"
                        aria-busy={submitting}
                        onSubmit={event => {
                            event.preventDefault()
                            void submit()
                        }}>
                        <DialogHeader>
                            <DialogTitle>{title}</DialogTitle>
                            <DialogDescription>
                                {m.provider_oauth_description({ provider })}
                            </DialogDescription>
                        </DialogHeader>
                        {provider === 'LinkedIn' ? (
                            <>
                                <Field>
                                    <FieldLabel htmlFor={`linkedin-destination-${channel.id}`}>
                                        {m.publisher_destination()}
                                    </FieldLabel>
                                    <Select
                                        value={destinationKind}
                                        onValueChange={value => {
                                            if (value) setDestinationKind(value)
                                            setError(null)
                                        }}>
                                        <SelectTrigger
                                            id={`linkedin-destination-${channel.id}`}
                                            disabled={disabled || submitting}>
                                            <SelectValue>
                                                {destinationKind === 'organization'
                                                    ? m.publisher_company_page()
                                                    : m.publisher_personal_account()}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="member">
                                                {m.publisher_personal_account()}
                                            </SelectItem>
                                            <SelectItem value="organization">
                                                {m.publisher_company_page()}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                {destinationKind === 'organization' ? (
                                    <Field>
                                        <FieldLabel htmlFor={`linkedin-organization-${channel.id}`}>
                                            {m.publisher_organization_id()}
                                        </FieldLabel>
                                        <Input
                                            id={`linkedin-organization-${channel.id}`}
                                            inputMode="numeric"
                                            disabled={disabled || submitting}
                                            value={organizationId}
                                            onChange={event => {
                                                setOrganizationId(event.target.value)
                                                setError(null)
                                            }}
                                        />
                                    </Field>
                                ) : null}
                            </>
                        ) : null}
                        <ProviderApplicationSelect
                            applications={applications}
                            disabled={disabled || submitting}
                            id={`${provider}-application-${channel.id}`}
                            value={applicationId ?? ''}
                            onValueChange={id => {
                                onApplicationChange(id)
                                setError(null)
                            }}
                        />
                        {error ? (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        ) : null}
                        <DialogFooter className="bg-transparent">
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={disabled || submitting}
                                onClick={() => setOpen(false)}>
                                {m.common_cancel()}
                            </Button>
                            <Button type="submit" disabled={disabled || submitting}>
                                {m.provider_continue_oauth({ provider })}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
