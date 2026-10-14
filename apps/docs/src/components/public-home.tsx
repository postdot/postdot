import { Button } from '@postbot/ui/components/button'
import Link from 'next/link'

import { PublicDestinations } from './public-destinations'
import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'
import { PublicMaterial } from './public-material'
import { PublicProduct } from './public-product'
import { PublicScrollControl } from './public-scroll-control'
import { PublicStory } from './public-story'

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
            <main>
                <section id="product" className="home-hero">
                    <PublicMaterial blendBottom />
                    <div className="home-intro">
                        <h1>
                            Social publishing.
                            <br />
                            For you and your agents.
                        </h1>
                        <p>
                            Write your next post, or let an agent prepare it. Review the content,
                            adapt each destination and manage what goes live.
                        </p>
                        <div className="home-actions">
                            <Action href="/docs/installation/">Self-host Postbot</Action>
                            <Action secondary href="/docs/">
                                Explore the docs
                            </Action>
                        </div>
                    </div>
                    <PublicProduct />
                </section>
                <PublicDestinations />
                <PublicStory />
            </main>
            <PublicFooter />
            <PublicScrollControl />
        </div>
    )
}
