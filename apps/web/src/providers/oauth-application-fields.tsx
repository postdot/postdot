import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'

import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationFieldsProps, OAuthApplicationFields } from './application-contract'
export function OAuthApplicationFields({
    form,
    onFormChange,
    editingId,
    preserveSecret,
    callbacks,
    fields,
}: ProviderApplicationFieldsProps & { readonly fields: OAuthApplicationFields }) {
    const secretLabel = fields.secretLabel?.() ?? m.provider_apps_client_secret()
    const callback = fields.callback ? callbacks[fields.callback] : undefined
    return (
        <>
            <Field className="gap-1.5">
                <FieldLabel htmlFor="provider-application-client-id">
                    {fields.clientLabel?.() ?? m.provider_apps_client_id()}
                </FieldLabel>
                <Input
                    id="provider-application-client-id"
                    inputMode={fields.numeric ? 'numeric' : undefined}
                    pattern={fields.numeric ? '[1-9][0-9]*' : undefined}
                    value={form.clientId}
                    onChange={event =>
                        onFormChange(current => ({ ...current, clientId: event.target.value }))
                    }
                    placeholder={
                        fields.numeric ? '123456789012345' : m.provider_apps_client_id_placeholder()
                    }
                />
            </Field>
            <Field className="gap-1.5">
                <FieldLabel htmlFor="provider-application-secret">{secretLabel}</FieldLabel>
                <Input
                    id="provider-application-secret"
                    type="password"
                    autoComplete="new-password"
                    value={form.clientSecret}
                    onChange={event =>
                        onFormChange(current => ({ ...current, clientSecret: event.target.value }))
                    }
                    placeholder={
                        editingId === null
                            ? secretLabel
                            : m.provider_apps_client_secret_placeholder()
                    }
                />
                {preserveSecret ? (
                    <FieldDescription>{m.provider_apps_secret_keep()}</FieldDescription>
                ) : null}
            </Field>
            {fields.callback ? (
                <Field className="gap-1.5">
                    <FieldLabel htmlFor={`provider-application-${fields.callback}-callback`}>
                        {fields.callbackLabel?.() ?? m.provider_apps_callback_uri()}
                    </FieldLabel>
                    <Input
                        id={`provider-application-${fields.callback}-callback`}
                        value={callback ?? ''}
                        readOnly
                    />
                    {fields.callbackHelp ? (
                        <FieldDescription>{fields.callbackHelp()}</FieldDescription>
                    ) : callback && !callback.startsWith('https://') ? (
                        <FieldDescription>
                            {fields.httpsHelp?.() ?? m.provider_apps_https_required()}
                        </FieldDescription>
                    ) : null}
                </Field>
            ) : null}
        </>
    )
}
