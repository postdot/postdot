import { Badge } from '@postbot/ui/components/badge'
import { Button } from '@postbot/ui/components/button'
import { DialogTrigger } from '@postbot/ui/components/dialog'
import { PenIcon } from '@solar-icons/react/linear/pen'

import { type ProviderApplication, type ProviderApplicationProvider } from '@/lib/api'
import * as m from '@/paraglide/messages.js'

export function ProviderApplicationRow({
    application,
    disabled,
    onEdit,
    onMakeDefault,
    onToggleState,
}: {
    readonly application: ProviderApplication
    readonly disabled: boolean
    readonly onEdit: (application: ProviderApplication) => void
    readonly onMakeDefault: (application: ProviderApplication) => void
    readonly onToggleState: (application: ProviderApplication) => void
}) {
    return (
        <article className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-heading text-base font-medium">
                        {application.name}
                    </h2>
                    <Badge
                        variant="secondary"
                        className={
                            application.state === 'active'
                                ? 'bg-transparent text-state-success'
                                : undefined
                        }>
                        {application.state === 'active'
                            ? m.provider_apps_active()
                            : m.provider_apps_disabled()}
                    </Badge>
                    {application.isDefault ? (
                        <Badge variant="outline">{m.provider_apps_default()}</Badge>
                    ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                    {providerLabel(application.providerId)}
                    {' · '}
                    {application.providerId === 'bluesky'
                        ? application.oauthMode === 'loopback'
                            ? m.provider_apps_loopback_oauth()
                            : m.provider_apps_public_metadata()
                        : application.hasClientSecret
                          ? m.provider_apps_configured()
                          : m.provider_apps_not_configured()}
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                <DialogTrigger
                    onClick={() => onEdit(application)}
                    render={<Button type="button" size="sm" variant="ghost" disabled={disabled} />}>
                    <PenIcon aria-hidden="true" />
                    {m.provider_apps_edit_action()}
                </DialogTrigger>
                {!application.isDefault && application.state === 'active' ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onMakeDefault(application)}
                        disabled={disabled}>
                        {m.provider_apps_make_default()}
                    </Button>
                ) : null}
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onToggleState(application)}
                    disabled={disabled}>
                    {application.state === 'active'
                        ? m.provider_apps_disable()
                        : m.provider_apps_enable()}
                </Button>
            </div>
        </article>
    )
}

function providerLabel(provider: ProviderApplicationProvider) {
    if (provider === 'linkedin') return m.provider_apps_provider_linkedin()
    if (provider === 'bluesky') return m.provider_apps_provider_bluesky()
    return m.provider_apps_provider_x()
}
