import { createFileRoute } from '@tanstack/react-router'

import { LegalPage } from '@/components/legal-page'
import { PrivacySettingsButton } from '@/components/privacy-settings-button'
import { legal } from '@/lib/legal'
import { withMaterial } from '@/lib/material'
import { seo } from '@/lib/social-metadata'

const description = 'What the Postdot website collects, why, and how to control it.'

export const Route = createFileRoute('/privacy')({
    head: () =>
        withMaterial(
            seo({ title: 'Privacy policy', description, image: '/og/home.png', path: '/privacy' })
        ),
    component: Privacy,
})

function Privacy() {
    return (
        <LegalPage title="Privacy policy" updated={legal.updated}>
            <p>
                This policy covers the Postdot website and documentation at postdot.app. It does not
                cover a Postdot instance that you run yourself: that software sends nothing to the
                publisher.
            </p>

            <h2>Who is responsible</h2>
            <p>
                {legal.publisher} publishes the site and is responsible for the data described here.
                Contact: open a discussion in the <a href={legal.contactUrl}>Postdot repository</a>.
                If your request involves personal data, say so without sharing it and the publisher
                will arrange a private channel.
            </p>

            <h2>Audience measurement</h2>
            <p>
                The site measures visits with {legal.analyticsHost}. This measurement sets no
                cookie, does not follow you across sites, and keeps no identifier that points to
                you. It respects the Do Not Track setting of your browser. It is used only to know
                which pages are read.
            </p>

            <h2>Session replay and heatmaps (only if you allow it)</h2>
            <p>
                If you accept all, or turn on Analytics in the cookie settings, about 15 percent of
                sessions may be recorded with the same instance: page views, clicks, scrolling and
                mouse movement. The text you type is masked before it leaves your browser.
                Recordings are used to find confusing pages and are not shared. If you decline, or
                do not answer, none of this runs.
            </p>
            <p>
                Your choice is stored in a cookie named <code>postdot-consent</code> for 12 months.
                You can change it at any time:
            </p>
            <p>
                <PrivacySettingsButton />
            </p>

            <h2>Feedback on pages</h2>
            <p>
                When you send feedback at the end of a documentation page, your message and your
                rating are posted publicly as a comment in a GitHub discussion of the Postdot
                repository, by a GitHub App. Do not include personal information. GitHub processes
                it under its own privacy statement. A note in your browser local storage remembers
                that you already rated a page.
            </p>

            <h2>Hosting</h2>
            <p>
                The site is served by {legal.host}. Like any host, it processes technical request
                data (such as your IP address) to deliver pages and protect the service.
            </p>

            <h2>Your rights</h2>
            <p>
                You can ask for access to, correction of or deletion of data about you, and object
                to its processing, through the contact channel above. If you are in the European
                Union you may also complain to your data protection authority (in France, the CNIL).
            </p>
        </LegalPage>
    )
}
