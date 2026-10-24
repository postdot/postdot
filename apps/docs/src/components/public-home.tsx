import { Button } from '@postdot/ui/components/button'

import { PublicDestinations } from './public-destinations'
import { PublicDistribution } from './public-distribution'
import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'
import { PublicMaterial } from './public-material'
import { PublicProduct } from './public-product'
import { PublicScrollControl } from './public-scroll-control'
import { PublicStory } from './public-story'
import { Link } from './site-link'

import './public-home.css'

function Action({
    href,
    children,
    secondary = false,
}: {
    href: string
    children: React.ReactNode
    secondary?: boolean
}) {
    return (
        <Button
            nativeButton={false}
            variant={secondary ? 'outline' : 'default'}
            render={<Link href={href} />}
            className={`home-action ${secondary ? 'home-action-secondary' : ''}`}>
            {children}
        </Button>
    )
}
export function PublicHome() {
    return (
        <div className="public-home">
            <PublicHeader />
            <main id="main-content" tabIndex={-1}>
                <div className="home-opening">
                    <PublicMaterial blendBottom />
                    <section id="product" className="home-hero">
                        <div className="home-intro">
                            <h1>
                                Social publishing.
                                <br />
                                For you and your agents.
                            </h1>
                            <p>
                                Write your next post, or let an agent prepare it. Review the
                                content, adapt each destination and manage what goes live.
                            </p>
                            <div className="home-actions">
                                <Action href="/docs/installation/">Self-host Postdot</Action>
                                <Action secondary href="/docs/">
                                    Explore the docs
                                </Action>
                            </div>
                            <p className="home-alpha">
                                <strong>Alpha.</strong> In active development. Available from
                                source.
                            </p>
                        </div>
                        <PublicProduct />
                    </section>
                    <PublicDestinations />
                </div>
                <PublicDistribution />
                <PublicStory />
            </main>
            <PublicFooter />
            <PublicScrollControl />
        </div>
    )
}
