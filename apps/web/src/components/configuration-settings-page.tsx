import { AltArrowRightIcon } from '@solar-icons/react/linear/alt-arrow-right'
import { SettingsIcon } from '@solar-icons/react/linear/settings'
import { UsersGroupTwoRoundedIcon } from '@solar-icons/react/linear/users-group-two-rounded'
import { Link } from '@tanstack/react-router'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { EmailSettingsForm } from '@/components/email-settings-form'
import { useDashboardGlobal } from '@/lib/dashboard-context'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function ConfigurationSettingsPage({
    projectId,
    workspaceId,
}: {
    readonly projectId?: string
    readonly workspaceId?: string
}) {
    useLanguage()
    const { isInstanceAdmin } = useDashboardGlobal()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="w-full">
                <DashboardPageHeader centered title={m.nav_instance()} />

                <section aria-label={m.nav_instance()} className="grid gap-3 md:grid-cols-2">
                    <Link
                        className="group flex min-w-0 items-center justify-between gap-3 rounded-md bg-surface-inset/45 p-4 shadow-surface transition-[background-color,transform] hover:-translate-y-px hover:bg-surface-inset/70"
                        search={{
                            invitation: undefined,
                            organizationInvitation: undefined,
                            projectId,
                            workspaceId,
                        }}
                        to="/dashboard/settings/access">
                        <span className="flex min-w-0 items-start gap-4">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-control text-foreground shadow-surface">
                                <UsersGroupTwoRoundedIcon aria-hidden="true" className="size-5" />
                            </span>
                            <span className="min-w-0">
                                <span className="block font-heading text-base font-medium">
                                    {m.configuration_access_title()}
                                </span>
                                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                                    {m.configuration_access_description()}
                                </span>
                            </span>
                        </span>
                        <span className="flex items-center gap-2 text-sm font-medium text-primary">
                            <AltArrowRightIcon
                                aria-hidden="true"
                                className="size-4 transition-transform group-hover:translate-x-0.5"
                            />
                        </span>
                    </Link>
                    <Link
                        className="group flex min-w-0 items-center justify-between gap-3 rounded-md bg-surface-inset/45 p-4 shadow-surface transition-[background-color,transform] hover:-translate-y-px hover:bg-surface-inset/70"
                        search={{ projectId, workspaceId }}
                        to="/dashboard/settings/provider-applications">
                        <span className="flex min-w-0 items-start gap-4">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-control text-foreground shadow-surface">
                                <SettingsIcon aria-hidden="true" className="size-5" />
                            </span>
                            <span className="min-w-0">
                                <span className="block font-heading text-base font-medium">
                                    {m.configuration_provider_apps_title()}
                                </span>
                                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                                    {m.configuration_provider_apps_description()}
                                </span>
                            </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-primary">
                            <AltArrowRightIcon
                                aria-hidden="true"
                                className="size-4 transition-transform group-hover:translate-x-0.5"
                            />
                        </span>
                    </Link>
                </section>
                {isInstanceAdmin && <EmailSettingsForm />}
            </div>
        </main>
    )
}
