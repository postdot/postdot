import { Button } from '@postbot/ui/components/button'
import { ArrowRightUpIcon } from '@solar-icons/react/linear/arrow-right-up'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicClients } from './public-clients'
import { PublicProduct } from './public-product'
import { PublicThemeToggle } from './public-theme-toggle'

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
                    <span>Postbot</span>
                </Link>
                <nav aria-label="Main navigation">
                    <Link href="#workflow">How it works</Link>
                    <Link href="/docs/">Documentation</Link>
                </nav>
                <div className="home-header-actions">
                    <PublicThemeToggle />
                    <Action href="/docs/installation/">Install</Action>
                </div>
            </header>
            <main>
                <section className="home-hero">
                    <div className="home-intro">
                        <h1>
                            One post.
                            <br />
                            Every destination.
                        </h1>
                        <p>
                            Prepare, adapt and schedule your publications.
                            <br className="home-desktop-break" /> Keep the content and the workflow
                            on your own infrastructure.
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
                <section id="workflow" className="home-client-section">
                    <div className="home-client-heading">
                        <h2>
                            For people.
                            <br />
                            And their agents.
                        </h2>
                        <Link href="/docs/automation/">
                            API and CLI <ArrowRightUpIcon size={18} aria-hidden="true" />
                        </Link>
                    </div>
                    <PublicClients />
                </section>
            </main>
            <footer className="home-footer">
                <div className="home-footer-content">
                    <Link href="/" className="home-footer-mark" aria-label="Postbot home">
                        <PostbotLogo />
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
                <div className="home-footer-signature" aria-hidden="true">
                    Postbot
                </div>
                <div className="home-footer-bottom">
                    <span>© 2026 Hakim Saoudi</span>
                    <span>AGPL-3.0-only</span>
                    <Link href="#">
                        Back to top <ArrowRightUpIcon size={16} aria-hidden="true" />
                    </Link>
                </div>
            </footer>
        </div>
    )
}
