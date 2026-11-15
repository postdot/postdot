import { PaletteIcon } from '@solar-icons/react/linear/palette'
import { TranslationIcon } from '@solar-icons/react/linear/translation'

import { LanguageSelect } from '@/components/language-switcher'
import {
    SettingsCard,
    SettingsPage,
    SettingsRow,
    SettingsSection,
} from '@/components/settings-layout'
import { ThemeSelect } from '@/components/theme-toggle'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function UserPreferencesPage() {
    useLanguage()
    return (
        <SettingsPage title={m.nav_preferences_general()}>
            <SettingsSection id="preferences-display" title={m.preferences_display_title()}>
                <SettingsCard>
                    <SettingsRow
                        control={<ThemeSelect id="preference-theme" />}
                        description={m.preferences_appearance_description()}
                        htmlFor="preference-theme"
                        icon={<PaletteIcon />}
                        title={m.preferences_theme()}
                    />
                    <SettingsRow
                        control={<LanguageSelect id="preference-language" />}
                        description={m.preferences_language_description()}
                        htmlFor="preference-language"
                        icon={<TranslationIcon />}
                        title={m.preferences_language()}
                    />
                </SettingsCard>
            </SettingsSection>
        </SettingsPage>
    )
}
