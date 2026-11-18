import { EmailSettingsForm } from '@/components/email-settings-form'
import { RecoverySettings } from '@/components/recovery-settings'
import { ReleaseSettings } from '@/components/release-settings'
import { SettingsPage } from '@/components/settings-layout'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ConfigurationSettingsPage() {
    useLanguage()
    const { isInstanceAdmin } = useDashboardGlobal()

    return (
        <SettingsPage title={m.nav_instance()}>
            {isInstanceAdmin && (
                <>
                    <RecoverySettings />
                    <EmailSettingsForm />
                </>
            )}
            {/* T2: build identity is reference information, so it closes the page. */}
            <ReleaseSettings />
        </SettingsPage>
    )
}
