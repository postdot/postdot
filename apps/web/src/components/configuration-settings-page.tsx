import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmailSettingsForm } from '@/components/email-settings-form'
import { PageColumn } from '@/components/page-column'
import { RecoverySettings } from '@/components/recovery-settings'
import { ReleaseSettings } from '@/components/release-settings'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ConfigurationSettingsPage() {
    useLanguage()
    const { isInstanceAdmin } = useDashboardGlobal()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="w-full">
                <DashboardPageHeader centered title={m.nav_instance()} />
                <PageColumn
                    className="[&>section:first-child]:mt-0 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0"
                    variant="reading">
                    <ReleaseSettings />
                    {isInstanceAdmin && (
                        <>
                            <RecoverySettings />
                            <EmailSettingsForm />
                        </>
                    )}
                </PageColumn>
            </div>
        </main>
    )
}
