import { Button } from '@postbot/ui/components/button'
import { ArrowRightUpIcon } from '@solar-icons/react/linear/arrow-right-up'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicProduct } from './public-product'
import { PublicStory } from './public-story'
import { PublicThemeToggle } from './public-theme-toggle'
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
            <header className="home-header">
                <Link href="/" className="home-brand" aria-label="Postbot home">
                    <PostbotLogo className="home-logo" />
                    <PublicWordmark />
                </Link>
                <nav aria-label="Main navigation">
                    <Link href="#workflow">Product</Link>
                    <Link href="/docs/">Documentation</Link>
                </nav>
                <div className="home-header-actions">
                    <PublicThemeToggle />
                    <Action href="/docs/installation/">Install</Action>
                </div>
            </header>
            <main>
                <section id="product" className="home-hero">
                    <div className="home-intro">
                        <h1>
                            One post.
                            <br />
                            Every destination.
                        </h1>
                        <p>
                            Write your next post, or let an agent prepare it.
                            <br className="home-desktop-break" /> Review, adapt and decide when it
                            goes live.
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
                <PublicStory />
            </main>
            <footer className="home-footer">
                <div className="home-footer-content">
                    <Link href="/" className="home-footer-mark" aria-label="Postbot home">
                        <PublicWordmark />
                    </Link>
                    <nav aria-label="Documentation links" className="home-footer-nav">
                        <div>
                            <h2>Start</h2>
                            <Link href="/docs/installation/">Installation</Link>
                            <Link href="/docs/first-publication/">First publication</Link>
                            <Link href="/docs/providers/">Connections</Link>
                        </div>
                        <div>
                            <h2>Build</h2>
                            <Link href="/docs/concepts/">Concepts</Link>
                            <Link href="/docs/automation/">API and CLI</Link>
                            <Link href="/docs/operations/">Operations</Link>
                        </div>
                    </nav>
                </div>

                <div className="home-footer-bottom">
                    <span>© 2026 Hakim Saoudi</span>
                    <span>Open source</span>
                    <Link href="#">
                        Back to top <ArrowRightUpIcon size={16} aria-hidden="true" />
                    </Link>
                </div>
            </footer>
        </div>
    )
}
