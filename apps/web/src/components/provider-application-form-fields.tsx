import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
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
    const isInstagram = form.providerId === 'instagram'
    const callbackUri = isInstagram ? instagramCallbackUri : facebookCallbackUri
    function selectProvider(value: string | null) {
        if (
            value !== 'linkedin' &&
            value !== 'bluesky' &&
            value !== 'x' &&
            value !== 'facebook' &&
            value !== 'instagram'
        )
            return
        onFormChange(current => ({
            ...current,
            providerId: value,
            clientId: '',
            clientMetadataUrl: '',
            handleResolver: value === 'bluesky' ? 'https://bsky.social' : '',
            blueskyOAuthMode: value === 'bluesky' ? 'loopback' : 'web',
            clientSecret: '',
        }))
    }

    return (
        <>
            <Field className="gap-1.5">
                <FieldLabel htmlFor="provider-application-provider">
                    {m.provider_apps_provider()}
                </FieldLabel>
                <Select
                    items={{
                        linkedin: m.provider_apps_provider_linkedin(),
                        bluesky: m.provider_apps_provider_bluesky(),
                        x: m.provider_apps_provider_x(),
                        facebook: m.provider_apps_provider_facebook(),
                        instagram: m.provider_apps_provider_instagram(),
                    }}
                    value={form.providerId}
                    onValueChange={selectProvider}>
                    <SelectTrigger id="provider-application-provider" disabled={editingId !== null}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                        <SelectItem value="linkedin">
                            {m.provider_apps_provider_linkedin()}
                        </SelectItem>
                        <SelectItem value="bluesky">
                            {m.provider_apps_provider_bluesky()}
                        </SelectItem>
                        <SelectItem value="facebook">
                            {m.provider_apps_provider_facebook()}
                        </SelectItem>
                        <SelectItem value="instagram">
                            {m.provider_apps_provider_instagram()}
                        </SelectItem>
                        <SelectItem value="x">{m.provider_apps_provider_x()}</SelectItem>
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

            {form.providerId === 'bluesky' ? (
                <>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="provider-application-bluesky-mode">
                            {m.provider_apps_bluesky_oauth_mode()}
                        </FieldLabel>
                        <Select
                            items={{
                                loopback: m.provider_apps_bluesky_oauth_mode_loopback(),
                                web: m.provider_apps_bluesky_oauth_mode_web(),
                            }}
                            value={form.blueskyOAuthMode}
                            onValueChange={value => {
                                if (value !== 'loopback' && value !== 'web') return
                                onFormChange(current => ({
                                    ...current,
                                    blueskyOAuthMode: value,
                                }))
                            }}>
                            <SelectTrigger id="provider-application-bluesky-mode">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start">
                                <SelectItem value="loopback">
                                    {m.provider_apps_bluesky_oauth_mode_loopback()}
                                </SelectItem>
                                <SelectItem value="web">
                                    {m.provider_apps_bluesky_oauth_mode_web()}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <FieldDescription>
                            {form.blueskyOAuthMode === 'loopback'
                                ? m.provider_apps_bluesky_loopback_help()
                                : m.provider_apps_bluesky_web_help()}
                        </FieldDescription>
                    </Field>
                    {form.blueskyOAuthMode === 'web' ? (
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="provider-application-metadata">
                                {m.provider_apps_client_metadata_url()}
                            </FieldLabel>
                            <Input
                                id="provider-application-metadata"
                                type="url"
                                value={form.clientMetadataUrl}
                                onChange={event =>
                                    onFormChange(current => ({
                                        ...current,
                                        clientMetadataUrl: event.target.value,
                                    }))
                                }
                                placeholder={m.provider_apps_client_metadata_url_placeholder()}
                            />
                        </Field>
                    ) : null}
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="provider-application-resolver">
                            {m.provider_apps_handle_resolver()}
                        </FieldLabel>
                        <Input
                            id="provider-application-resolver"
                            type="url"
                            value={form.handleResolver}
                            onChange={event =>
                                onFormChange(current => ({
                                    ...current,
                                    handleResolver: event.target.value,
                                }))
                            }
                            placeholder={m.provider_apps_handle_resolver_placeholder()}
                        />
                    </Field>
                </>
            ) : (
                <>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="provider-application-client-id">
                            {form.providerId === 'instagram'
                                ? m.provider_instagram_app_id()
                                : form.providerId === 'facebook'
                                  ? m.provider_facebook_app_id()
                                  : m.provider_apps_client_id()}
                        </FieldLabel>
                        <Input
                            id="provider-application-client-id"
                            inputMode={
                                form.providerId === 'facebook' || form.providerId === 'instagram'
                                    ? 'numeric'
                                    : undefined
                            }
                            pattern={
                                form.providerId === 'facebook' || form.providerId === 'instagram'
                                    ? '[1-9][0-9]*'
                                    : undefined
                            }
                            value={form.clientId}
                            onChange={event =>
                                onFormChange(current => ({
                                    ...current,
                                    clientId: event.target.value,
                                }))
                            }
                            placeholder={
                                form.providerId === 'facebook' || form.providerId === 'instagram'
                                    ? '123456789012345'
                                    : m.provider_apps_client_id_placeholder()
                            }
                        />
                    </Field>
                    <Field className="gap-1.5">
                        <FieldLabel htmlFor="provider-application-secret">
                            {form.providerId === 'instagram'
                                ? m.provider_instagram_app_secret()
                                : form.providerId === 'facebook'
                                  ? m.provider_facebook_app_secret()
                                  : m.provider_apps_client_secret()}
                        </FieldLabel>
                        <Input
                            id="provider-application-secret"
                            type="password"
                            autoComplete="new-password"
                            value={form.clientSecret}
                            onChange={event =>
                                onFormChange(current => ({
                                    ...current,
                                    clientSecret: event.target.value,
                                }))
                            }
                            placeholder={
                                editingId === null
                                    ? form.providerId === 'instagram'
                                        ? m.provider_instagram_app_secret()
                                        : form.providerId === 'facebook'
                                          ? m.provider_facebook_app_secret()
                                          : m.provider_apps_client_secret()
                                    : m.provider_apps_client_secret_placeholder()
                            }
                        />
                        {preserveSecret ? (
                            <FieldDescription>{m.provider_apps_secret_keep()}</FieldDescription>
                        ) : null}
                    </Field>
                    {form.providerId === 'facebook' || isInstagram ? (
                        <Field className="gap-1.5">
                            <FieldLabel
                                htmlFor={`provider-application-${form.providerId}-callback`}>
                                {m.provider_apps_callback_uri()}
                            </FieldLabel>
                            <Input
                                id={`provider-application-${form.providerId}-callback`}
                                value={callbackUri ?? ''}
                                readOnly
                            />
                            {callbackUri && !callbackUri.startsWith('https://') ? (
                                <FieldDescription>
                                    {isInstagram
                                        ? m.provider_instagram_https_required()
                                        : m.provider_apps_https_required()}
                                </FieldDescription>
                            ) : null}
                        </Field>
                    ) : null}
                    {form.providerId === 'x' ? (
                        <Field className="gap-1.5">
                            <FieldLabel htmlFor="provider-application-x-callback">
                                {m.provider_apps_x_callback_uri()}
                            </FieldLabel>
                            <Input
                                id="provider-application-x-callback"
                                readOnly
                                value={xCallbackUri}
                            />
                            <FieldDescription>{m.provider_apps_x_callback_help()}</FieldDescription>
                        </Field>
                    ) : null}
                </>
            )}
        </>
    )
}
