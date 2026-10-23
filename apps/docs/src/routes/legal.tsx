import { createFileRoute } from '@tanstack/react-router'

import { LegalPage } from '@/components/legal-page'
import { Link } from '@/components/site-link'
import { legal } from '@/lib/legal'
import { withMaterial } from '@/lib/material'
import { seo } from '@/lib/social-metadata'

const description = 'Publisher and hosting information for the Postdot website.'

export const Route = createFileRoute('/legal')({
    head: () =>
        withMaterial(
            seo({ title: 'Legal notice', description, image: '/og/home.png', path: '/legal' })
        ),
    component: Legal,
})

function Legal() {
    return (
        <LegalPage title="Legal notice" updated={legal.updated}>
            <h2>Publisher</h2>
            <p>
                The website postdot.app is published by {legal.publisher}, who is also the
                publication director. Contact:{' '}
                <a href={`mailto:${legal.contactEmail}`}>{legal.contactEmail}</a>.
            </p>

            <h2>Hosting</h2>
            <p>{legal.host}.</p>

            <h2>Software and content</h2>
            <p>
                Postdot is open source under the AGPL-3.0-only license; the source code is available
                at <a href="https://github.com/postdot/postdot">github.com/postdot/postdot</a>.
                Third party licenses and notices are kept in the repository. The name, logo and
                texts of this website are not covered by that license unless stated otherwise.
            </p>

            <h2>Personal data</h2>
            <p>
                See the <Link href="/privacy">privacy policy</Link> for what the website collects
                and how to control it.
            </p>
        </LegalPage>
    )
}
