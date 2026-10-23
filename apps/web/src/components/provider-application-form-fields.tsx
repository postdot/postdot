import { Field, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'
import type { Dispatch, SetStateAction } from 'react'

import type { ProviderApplicationFormState } from '@/components/provider-application-form'
import * as m from '@/paraglide/messages.js'
import { installedProviders, providerRegistry } from '@/providers/registry'

export function ProviderApplicationFormFields({
    editingId,
    form,
    onFormChange,
    xCallbackUri,
    facebookCallbackUri,
    instagramCallbackUri,
    preserveSecret,
}: {
    readonly editingId: string | null
    readonly form: ProviderApplicationFormState
    readonly onFormChange: Dispatch<SetStateAction<ProviderApplicationFormState>>
    readonly preserveSecret: boolean
    readonly instagramCallbackUri?: string
    readonly facebookCallbackUri?: string
    readonly xCallbackUri: string
}) {
    const providers = installedProviders
        .map(provider => providerRegistry.get(provider.id)!)
        .filter(provider => provider.applicationProvider !== undefined)
    const application = providerRegistry.get(form.providerId)?.application
    function selectProvider(value: string | null) {
        const provider = providers.find(provider => provider.id === value)
        if (!provider?.applicationProvider || !provider.application) return
        onFormChange(current => ({
            ...current,
            providerId: provider.applicationProvider!,
            clientId: '',
            clientMetadataUrl: '',
            handleResolver: '',
            blueskyOAuthMode: 'web',
            clientSecret: '',
            ...provider.application?.defaults,
        }))
    }
    return (
        <>
            <Field className="gap-1.5">
                <FieldLabel htmlFor="provider-application-provider">
                    {m.provider_apps_provider()}
                </FieldLabel>
                <Select
                    items={Object.fromEntries(
                        providers.map(provider => [provider.id, provider.application!.label()])
                    )}
                    value={form.providerId}
                    onValueChange={selectProvider}>
                    <SelectTrigger id="provider-application-provider" disabled={editingId !== null}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                        {providers.map(provider => (
                            <SelectItem key={provider.id} value={provider.id}>
                                {provider.application!.label()}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>

            <Field className="gap-1.5">
                <FieldLabel htmlFor="provider-application-name">
                    {m.provider_apps_name()}
                </FieldLabel>
                <Input
                    id="provider-application-name"
                    value={form.name}
                    onChange={event =>
                        onFormChange(current => ({
                            ...current,
                            name: event.target.value,
                        }))
                    }
                    placeholder={m.provider_apps_name_placeholder()}
                />
            </Field>

            {application ? (
                <application.Fields
                    form={form}
                    onFormChange={onFormChange}
                    editingId={editingId}
                    preserveSecret={preserveSecret}
                    callbacks={{
                        x: xCallbackUri,
                        facebook: facebookCallbackUri,
                        instagram: instagramCallbackUri,
                    }}
                />
            ) : null}
        </>
    )
}
