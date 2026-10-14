import { Button } from '@postbot/ui/components/button'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicDestinations } from './public-destinations'
import { PublicHeader } from './public-header'
import { PublicProduct } from './public-product'
import { PublicScrollControl } from './public-scroll-control'
import { PublicStory } from './public-story'
import { PublicWordmark } from './public-wordmark'

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
            <footer className="home-footer">
                <div className="home-footer-content">
                    <Link href="/" className="home-footer-mark" aria-label="Postbot home">
                        <PostbotLogo className="home-footer-logo" />
                        <PublicWordmark />
                    </Link>
                    <nav aria-label="Documentation links" className="home-footer-nav">
                        <div>
                            <h2>Postbot</h2>
                            <Link href="/#workflow">Workflow</Link>
                            <Link href="/#planning">Planning</Link>
                            <Link href="/#automation">For agents</Link>
                        </div>
                        <div>
                            <h2>Guides</h2>
                            <Link href="/docs/installation/">Installation</Link>
                            <Link href="/docs/automation/">API and CLI</Link>
                            <Link href="/docs/operations/">Operations</Link>
                        </div>
                    </nav>
                </div>

                <div className="home-footer-bottom">
                    <span>© 2026 Hakim Saoudi</span>
                    <span>Open source</span>
                </div>
            </footer>
            <PublicScrollControl />
        </div>
    )
}
