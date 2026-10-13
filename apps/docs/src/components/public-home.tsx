import { Button } from '@postbot/ui/components/button'
import { ArrowRightUpIcon } from '@solar-icons/react/linear/arrow-right-up'
import Link from 'next/link'

import { PostbotLogo } from './brand'
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
                    <figure className="home-product">
                        <img
                            className="home-shot home-shot-light"
                            src="/product/compose-light.webp"
                            alt="Postbot composer with shared source content, destinations, preview and scheduling controls"
                            width="1440"
                            height="900"
                            fetchPriority="high"
                        />
                        <img
                            className="home-shot home-shot-dark"
                            src="/product/compose-dark.webp"
                            alt="Postbot composer in dark mode"
                            width="1440"
                            height="900"
                            fetchPriority="high"
                        />
                    </figure>
                </section>
                <section id="workflow" className="home-workflow">
                    <div className="home-section-heading">
                        <span className="home-eyebrow">From idea to publication</span>
                        <h2>
                            Keep the source.
                            <br />
                            Give each destination its own voice.
                        </h2>
                    </div>
                    <div className="home-steps">
                        <article>
                            <span className="home-step-number">01</span>
                            <h3>Compose once</h3>
                            <p>Text and media start in one shared post.</p>
                            <Link href="/docs/concepts/">
                                Posts and destinations{' '}
                                <ArrowRightUpIcon size={16} aria-hidden="true" />
                            </Link>
                        </article>
                        <article>
                            <span className="home-step-number">02</span>
                            <h3>Adapt where it matters</h3>
                            <p>Each publication keeps its own content, format and date.</p>
                            <Link href="/docs/first-publication/">
                                Your first publication{' '}
                                <ArrowRightUpIcon size={16} aria-hidden="true" />
                            </Link>
                        </article>
                        <article>
                            <span className="home-step-number">03</span>
                            <h3>Follow the outcome</h3>
                            <p>
                                Schedule connected channels. Track manual work and handle failures.
                            </p>
                            <Link href="/docs/providers/">
                                Provider connections{' '}
                                <ArrowRightUpIcon size={16} aria-hidden="true" />
                            </Link>
                        </article>
                    </div>
                </section>
                <section className="home-ownership">
                    <div>
                        <span className="home-eyebrow">Your workspace, your infrastructure</span>
                        <h2>
                            Built to be self-hosted.
                            <br />
                            Open by design.
                        </h2>
                        <p>
                            A web workspace for people, an API and CLI for automation. The same
                            posts and destinations, without a second source of truth.
                        </p>
                        <Action href="/docs/automation/" secondary>
                            API and CLI
                        </Action>
                    </div>
                    <div className="home-runtime">
                        <div className="home-runtime-brand">
                            <PostbotLogo />
                            <span>Postbot</span>
                        </div>
                        <dl>
                            <div>
                                <dt>License</dt>
                                <dd>AGPL-3.0-only</dd>
                            </div>
                            <div>
                                <dt>Runtime</dt>
                                <dd>Bun</dd>
                            </div>
                            <div>
                                <dt>Storage</dt>
                                <dd>SQLite · local or S3 media</dd>
                            </div>
                        </dl>
                        <Link href="/docs/operations/">
                            Backups and updates <ArrowRightUpIcon size={16} aria-hidden="true" />
                        </Link>
                    </div>
                </section>
                <section className="home-start">
                    <div>
                        <h2>Make room for your next post.</h2>
                        <p>Start with the installation guide.</p>
                    </div>
                    <Action href="/docs/installation/">Set up Postbot</Action>
                </section>
            </main>
            <footer className="home-footer">
                <Link href="/" className="home-brand">
                    <PostbotLogo className="home-logo" />
                    <span>Postbot</span>
                </Link>
                <span>Self-hosted publication management</span>
                <Link href="/docs/">
                    Documentation <ArrowRightUpIcon size={16} aria-hidden="true" />
                </Link>
            </footer>
        </div>
    )
}
