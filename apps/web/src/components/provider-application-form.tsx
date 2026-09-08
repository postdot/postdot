import { Button } from '@herald/ui/components/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@herald/ui/components/card'
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldTitle,
} from '@herald/ui/components/field'
import { Input } from '@herald/ui/components/input'
import { Switch } from '@herald/ui/components/switch'
import { type Dispatch, type FormEvent, type SetStateAction } from 'react'

import { ProviderApplicationFormFields } from '@/components/provider-application-form-fields'
import {
    type ProviderApplication,
    type ProviderApplicationInput,
    type ProviderApplicationProvider,
} from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export interface ProviderApplicationFormState {
    readonly providerId: ProviderApplicationProvider
    readonly name: string
    readonly clientId: string
    readonly clientMetadataUrl: string
    readonly handleResolver: string
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
}: {
    readonly editingApplication?: ProviderApplication
    readonly editingId: string | null
    readonly form: ProviderApplicationFormState
    readonly onCancel: () => void
    readonly onFormChange: Dispatch<SetStateAction<ProviderApplicationFormState>>
    readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
    readonly pending: boolean
}) {
    const requiresSecret =
        form.providerId !== 'bluesky' &&
        (editingApplication === undefined || !editingApplication.hasClientSecret)
    const canSubmit =
        form.name.trim() !== '' &&
        (form.providerId === 'bluesky'
            ? form.clientMetadataUrl.trim() !== ''
            : form.clientId.trim() !== '' && (!requiresSecret || form.clientSecret.trim() !== ''))

    return (
        <Card className="rounded-md">
            <CardHeader>
                <CardTitle>
                    {editingId === null ? m.provider_apps_new() : m.provider_apps_edit()}
                </CardTitle>
                <CardDescription>{m.provider_apps_setup_note()}</CardDescription>
            </CardHeader>
            <CardContent>
                <form className="space-y-5" onSubmit={onSubmit}>
                    <FieldGroup className="gap-4">
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

                        <ProviderApplicationFormFields
                            editingId={editingId}
                            form={form}
                            onFormChange={onFormChange}
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
                                <FieldDescription>
                                    {m.provider_apps_default_help()}
                                </FieldDescription>
                            </FieldContent>
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-wrap gap-2 pt-1">
                        <Button type="submit" disabled={!canSubmit || pending}>
                            {editingId === null ? m.provider_apps_create() : m.provider_apps_save()}
                        </Button>
                        {editingId !== null ? (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={onCancel}
                                disabled={pending}>
                                {m.provider_apps_cancel_edit()}
                            </Button>
                        ) : null}
                    </div>
                </form>
            </CardContent>
        </Card>
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
            clientMetadataUrl: form.clientMetadataUrl.trim(),
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
