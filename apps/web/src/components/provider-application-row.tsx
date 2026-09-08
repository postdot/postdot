import { Badge } from '@herald/ui/components/badge'
import { Button } from '@herald/ui/components/button'
import { Card, CardContent } from '@herald/ui/components/card'
import { PenIcon } from '@solar-icons/react/bold/pen'

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
        <Card size="sm" className="rounded-md">
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-heading text-base font-medium">
                            {application.name}
                        </h3>
                        <Badge variant={application.state === 'active' ? 'default' : 'secondary'}>
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
                <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(application)}
                        disabled={disabled}>
                        <PenIcon aria-hidden="true" />
                        {m.provider_apps_edit_action()}
                    </Button>
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
            </CardContent>
        </Card>
    )
}

function providerLabel(provider: ProviderApplicationProvider) {
    if (provider === 'linkedin') return m.provider_apps_provider_linkedin()
    if (provider === 'bluesky') return m.provider_apps_provider_bluesky()
    return m.provider_apps_provider_x()
}
