import { Field, FieldDescription, FieldLabel } from '@postdot/ui/components/field'
import { Input } from '@postdot/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@postdot/ui/components/select'

import * as m from '@/paraglide/messages.js'

import type { ProviderApplicationFieldsProps } from '../application-contract'

export default function BlueskyApplicationFields({
    form,
    onFormChange,
}: ProviderApplicationFieldsProps) {
    return (
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
    )
}
