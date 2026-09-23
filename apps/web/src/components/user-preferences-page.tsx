import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function UserPreferencesPage() {
    useLanguage()

    return (
        <main className="min-w-0 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="mx-auto w-full max-w-6xl">
                <DashboardPageHeader
                    description={m.nav_preferences_description()}
                    title={m.nav_preferences_general()}
                />

                <div className="grid w-full gap-3">
                    <section className="flex flex-col gap-4 bg-surface-inset/45 p-5 shadow-surface sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="font-heading text-base font-medium">
                                {m.preferences_appearance()}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {m.preferences_appearance_description()}
                            </p>
                        </div>
                        <ThemeToggle />
                    </section>

                    <section className="flex flex-col gap-4 bg-surface-inset/45 p-5 shadow-surface sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <h2 className="font-heading text-base font-medium">
                                {m.preferences_language()}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {m.preferences_language_description()}
                            </p>
                        </div>
                        <LanguageSwitcher />
                    </section>
                </div>
            </div>
        </main>
    )
}
