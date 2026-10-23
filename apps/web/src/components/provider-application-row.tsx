import { Badge } from '@postdot/ui/components/badge'
import { Button } from '@postdot/ui/components/button'
import { DialogTrigger } from '@postdot/ui/components/dialog'
import { PenIcon } from '@solar-icons/react/linear/pen'

import { type ProviderApplication } from '@/lib/api'
import * as m from '@/paraglide/messages.js'
import { providerRegistry } from '@/providers/registry'

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
                    {providerRegistry.get(application.providerId)?.application?.label() ??
                        application.providerId}
                    {' · '}
                    {providerRegistry.get(application.providerId)?.application?.status(application)}
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
