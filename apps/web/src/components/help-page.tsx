import { BookIcon } from '@solar-icons/react/linear/book'
import { BugIcon } from '@solar-icons/react/linear/bug'
import { CodeIcon } from '@solar-icons/react/linear/code'
import { HistoryIcon } from '@solar-icons/react/linear/history'
import { NotebookIcon } from '@solar-icons/react/linear/notebook'

import {
    SettingsCard,
    SettingsLinkRow,
    SettingsPage,
    SettingsSection,
} from '@/components/settings-layout'
import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

const site = 'https://postdot.app'
const repository = 'https://github.com/postdot/postdot'

/** Where Studio meets its documentation and the people around Postdot. */
export function HelpPage() {
    useLanguage()
    return (
        <SettingsPage title={m.help_title()}>
            <SettingsSection
                description={m.help_learn_description()}
                id="help-learn"
                title={m.help_learn_title()}>
                <SettingsCard>
                    <SettingsLinkRow
                        description={m.help_docs_description()}
                        external
                        href={`${site}/docs`}
                        icon={<BookIcon />}
                        title={m.help_docs()}
                    />
                    <SettingsLinkRow
                        description={m.help_guides_description()}
                        external
                        href={`${site}/docs/first-publication`}
                        icon={<NotebookIcon />}
                        title={m.help_guides()}
                    />
                    <SettingsLinkRow
                        description={m.help_releases_description()}
                        external
                        href={`${site}/blog`}
                        icon={<HistoryIcon />}
                        title={m.help_releases()}
                    />
                </SettingsCard>
            </SettingsSection>
            <SettingsSection
                description={m.help_community_description()}
                id="help-community"
                title={m.help_community_title()}>
                <SettingsCard>
                    <SettingsLinkRow
                        description={m.help_source_description()}
                        external
                        href={repository}
                        icon={<CodeIcon />}
                        title={m.help_source()}
                    />
                    <SettingsLinkRow
                        description={m.help_issue_description()}
                        external
                        href={`${repository}/issues/new/choose`}
                        icon={<BugIcon />}
                        title={m.help_issue()}
                    />
                </SettingsCard>
            </SettingsSection>
        </SettingsPage>
    )
}
