import type { ReactNode } from 'react'

import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { LanguageSelect } from '@/components/language-switcher'
import { ThemeSelect } from '@/components/theme-toggle'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function UserPreferencesPage() {
    useLanguage()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <DashboardPageHeader column="reading" title={m.nav_preferences_general()} />
            <div className="mx-auto w-full max-w-xl divide-y divide-border/60 rounded-md bg-surface-raised shadow-surface">
                <PreferenceRow
                    control={<ThemeSelect id="preference-theme" />}
                    description={m.preferences_appearance_description()}
                    htmlFor="preference-theme"
                    label={m.preferences_theme()}
                />
                <PreferenceRow
                    control={<LanguageSelect id="preference-language" />}
                    description={m.preferences_language_description()}
                    htmlFor="preference-language"
                    label={m.preferences_language()}
                />
            </div>
        </main>
    )
}

function PreferenceRow({
    control,
    description,
    htmlFor,
    label,
}: {
    readonly control: ReactNode
    readonly description: string
    readonly htmlFor: string
    readonly label: string
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
            <div className="min-w-0">
                <label className="text-sm font-medium" htmlFor={htmlFor}>
                    {label}
                </label>
                <p className="mt-0.5 text-xs/5 text-muted-foreground">{description}</p>
            </div>
            {control}
        </div>
    )
}
