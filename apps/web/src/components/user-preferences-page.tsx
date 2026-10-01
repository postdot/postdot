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
                <DashboardPageHeader centered title={m.nav_preferences_general()} />

                <div className="mx-auto grid w-full max-w-xl gap-3">
                    <section className="flex items-center justify-between gap-4 rounded-md bg-surface-inset/45 px-4 py-3 shadow-surface">
                        <div className="min-w-0">
                            <h2 className="font-heading text-base font-medium">
                                {m.preferences_appearance()}
                            </h2>
                        </div>
                        <ThemeToggle />
                    </section>

                    <section className="flex items-center justify-between gap-4 rounded-md bg-surface-inset/45 px-4 py-3 shadow-surface">
                        <div className="min-w-0">
                            <h2 className="font-heading text-base font-medium">
                                {m.preferences_language()}
                            </h2>
                        </div>
                        <LanguageSwitcher />
                    </section>
                </div>
            </div>
        </main>
    )
}
