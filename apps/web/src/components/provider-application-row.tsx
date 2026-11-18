import { Button } from '@postdot/ui/components/button'
import { DialogTrigger } from '@postdot/ui/components/dialog'
import { PenIcon } from '@solar-icons/react/linear/pen'

import { ChannelAvatar } from '@/components/identity-visuals'
import { SettingsRow } from '@/components/settings-layout'
import { StatusText } from '@/components/status-text'
import { type ProviderApplication } from '@/lib/api'
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
        <article>
            <SettingsRow
                title={<h2>{application.name}</h2>}
                icon={
                    <ChannelAvatar
                        channel={{
                            id: application.id,
                            name: application.name,
                            profileId: application.providerId,
                            imageUrl: null,
                        }}
                    />
                }
                description={
                    <>
                        <StatusText tone={application.state === 'active' ? 'positive' : 'neutral'}>
                            {application.state === 'active'
                                ? m.provider_apps_active()
                                : m.provider_apps_disabled()}
                        </StatusText>
                        {application.isDefault ? ` · ${m.provider_apps_default()}` : ''}
                    </>
                }
                control={
                    <div className="flex flex-wrap gap-2">
                        <DialogTrigger
                            onClick={() => onEdit(application)}
                            render={
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={disabled}
                                />
                            }>
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
                }
            />
        </article>
    )
}
