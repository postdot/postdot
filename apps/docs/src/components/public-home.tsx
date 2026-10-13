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
                    <PublicThemeToggle />
                </nav>
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
                <div className="home-footer-top">
                    <Link href="/" className="home-brand" aria-label="Postbot home">
                        <PostbotLogo className="home-logo" />
                        <span>Postbot</span>
                    </Link>
                    <Link href="/docs/">
                        Documentation <ArrowRightUpIcon size={18} aria-hidden="true" />
                    </Link>
                </div>
                <div className="home-footer-signature" aria-hidden="true">
                    <span>Postbot</span>
                    <PostbotLogo />
                </div>
            </footer>
        </div>
    )
}
