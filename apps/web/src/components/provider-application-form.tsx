import { Button } from '@herald/ui/components/button'
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldTitle,
} from '@herald/ui/components/field'
import { Switch } from '@herald/ui/components/switch'
import { type Dispatch, type FormEvent, type SetStateAction } from 'react'

import { ProviderApplicationFormFields } from '@/components/provider-application-form-fields'
import {
    type ProviderApplication,
    type ProviderApplicationInput,
    type ProviderApplicationProvider,
} from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export type BlueskyOAuthMode = 'loopback' | 'web'

export interface ProviderApplicationFormState {
    readonly providerId: ProviderApplicationProvider
    readonly name: string
    readonly clientId: string
    readonly clientMetadataUrl: string
    readonly handleResolver: string
    readonly blueskyOAuthMode: BlueskyOAuthMode
    readonly clientSecret: string
    readonly isDefault: boolean
}

export function newProviderApplicationForm(): ProviderApplicationFormState {
    return {
        providerId: 'linkedin',
        name: '',
        clientId: '',
        clientMetadataUrl: '',
        handleResolver: 'https://bsky.social',
        blueskyOAuthMode: 'loopback',
        clientSecret: '',
        isDefault: false,
    }
}

export function ProviderApplicationForm({
    editingApplication,
    editingId,
    form,
    onCancel,
    onFormChange,
    onSubmit,
    pending,
    xCallbackUri,
}: {
    readonly editingApplication?: ProviderApplication
    readonly editingId: string | null
    readonly form: ProviderApplicationFormState
    readonly onCancel: () => void
    readonly onFormChange: Dispatch<SetStateAction<ProviderApplicationFormState>>
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly pending: boolean
    readonly xCallbackUri: string
}) {
    const requiresSecret =
        form.providerId !== 'bluesky' &&
        (editingApplication === undefined || !editingApplication.hasClientSecret)
    const canSubmit =
        form.name.trim() !== '' &&
        (form.providerId === 'bluesky'
            ? form.blueskyOAuthMode === 'loopback' || form.clientMetadataUrl.trim() !== ''
            : form.clientId.trim() !== '' && (!requiresSecret || form.clientSecret.trim() !== ''))

    return (
        <form className="space-y-5" onSubmit={onSubmit}>
            <fieldset disabled={pending} className="min-w-0 space-y-5">
                <FieldGroup className="gap-4">
                    <ProviderApplicationFormFields
                        editingId={editingId}
                        form={form}
                        onFormChange={onFormChange}
                        xCallbackUri={xCallbackUri}
                    />

                    <Field orientation="horizontal" className="items-start">
                        <Switch
                            id="provider-application-default"
                            checked={form.isDefault}
                            onCheckedChange={checked =>
                                onFormChange(current => ({
                                    ...current,
                                    isDefault: checked,
                                }))
                            }
                            disabled={
                                pending ||
                                (editingApplication?.isDefault === true && form.isDefault)
                            }
                        />
                        <FieldContent>
                            <FieldLabel htmlFor="provider-application-default">
                                <FieldTitle>{m.provider_apps_default()}</FieldTitle>
                            </FieldLabel>
                            <FieldDescription>{m.provider_apps_default_help()}</FieldDescription>
                        </FieldContent>
                    </Field>
                </FieldGroup>

                <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
                        {m.common_cancel()}
                    </Button>
                    <Button type="submit" disabled={!canSubmit || pending}>
                        {editingId === null ? m.provider_apps_create() : m.provider_apps_save()}
                    </Button>
                </div>
            </fieldset>
        </form>
    )
}

export function providerApplicationInput(
    form: ProviderApplicationFormState,
    includeProvider: true
): ProviderApplicationInput
export function providerApplicationInput(
    form: ProviderApplicationFormState,
    includeProvider: false
): Omit<ProviderApplicationInput, 'providerId'>
export function providerApplicationInput(
    form: ProviderApplicationFormState,
    includeProvider: boolean
): ProviderApplicationInput | Omit<ProviderApplicationInput, 'providerId'> {
    if (form.providerId === 'bluesky') {
        return {
            ...(includeProvider ? { providerId: form.providerId } : {}),
            name: form.name.trim(),
            clientMetadataUrl:
                form.blueskyOAuthMode === 'loopback' ? null : form.clientMetadataUrl.trim(),
            handleResolver: form.handleResolver.trim() || 'https://bsky.social',
            isDefault: form.isDefault,
        }
    }

    return {
        ...(includeProvider ? { providerId: form.providerId } : {}),
        name: form.name.trim(),
        clientId: form.clientId.trim(),
        ...(form.clientSecret.trim() === '' ? {} : { clientSecret: form.clientSecret.trim() }),
        isDefault: form.isDefault,
    }
}
