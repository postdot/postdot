'use client'

import { useSearchContext } from 'fumadocs-ui/contexts/search'
import { useTheme } from 'fumadocs-ui/provider/base'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useState } from 'react'

import { HeraldLogo } from './brand'

const adaptations = [
    {
        name: 'Source',
        title: 'A new chapter.',
        body: 'We are opening our workshop. Follow along as we build, share what we learn, and make room for new ideas.',
        note: 'The starting point for every destination.',
    },
    {
        name: 'Bluesky',
        title: 'Short. Direct.',
        body: 'Our workshop is open. New ideas, work in progress, and everything we learn along the way. Come say hello.',
        note: 'A shorter adaptation, with its own voice.',
    },
    {
        name: 'LinkedIn',
        title: 'A little more context.',
        body: 'Today we are opening our workshop to the community. We will share our process, the decisions behind our work, and lessons from building in the open.',
        note: 'More context for a different audience.',
    },
    {
        name: 'Manual',
        title: 'Still part of the plan.',
        body: 'We are opening our workshop. Join us for a conversation about what comes next.',
        note: 'Track a destination you publish yourself.',
    },
]

export function Home() {
    const [selected, setSelected] = useState(0)
    const reduced = useReducedMotion()
    const { setOpenSearch } = useSearchContext()
    const { resolvedTheme, setTheme } = useTheme()
    const adaptation = adaptations[selected]!
    return (
        <div className="public-site">
            <a className="skip-link" href="#main">
                Skip to content
            </a>
            <header className="site-header">
                <Link href="/" className="brand">
                    <HeraldLogo className="brand-mark" />
                    Herald
                </Link>
                <nav aria-label="Main navigation">
                    <Link href="/docs/">Documentation</Link>
                    <button onClick={() => setOpenSearch(true)}>
                        Search <kbd>⌘ / Ctrl K</kbd>
                    </button>
                    <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                        Theme
                    </button>
                </nav>
            </header>
            <main id="main">
                <section className="hero">
                    <div className="hero-copy">
                        <h1>
                            One post.
                            <br />
                            Room for
                            <br />
                            every voice.
                        </h1>
                        <p>
                            Prepare your source. Shape it for each destination.
                            <br className="desktop-break" /> Publish from your own infrastructure.
                        </p>
                        <Link className="primary-link" href="/docs/installation/">
                            Install Herald <span aria-hidden="true">↗</span>
                        </Link>
                    </div>
                    <div className="adaptation-demo" aria-label="Illustrative post adaptations">
                        <div className="demo-origin">
                            <HeraldLogo className="demo-mark" />
                            <span>A new chapter</span>
                        </div>
                        <div className="demo-routing" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </div>
                        <div
                            className="destination-selector"
                            role="group"
                            aria-label="Preview an adaptation">
                            {adaptations.map((item, index) => (
                                <button
                                    key={item.name}
                                    aria-pressed={selected === index}
                                    onClick={() => setSelected(index)}>
                                    {item.name}
                                </button>
                            ))}
                        </div>
                        <div className="demo-paper">
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.div
                                    key={selected}
                                    initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: reduced ? 0 : 0.16 }}>
                                    <p className="demo-title">{adaptation.title}</p>
                                    <p className="demo-body">{adaptation.body}</p>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                        <p className="demo-note" aria-live="polite">
                            {adaptation.note}
                        </p>
                    </div>
                </section>
                <section className="product-story" aria-labelledby="story-title">
                    <h2 id="story-title">
                        Shared origin.
                        <br />
                        Independent destinations.
                    </h2>
                    <div className="story-copy">
                        <p>
                            A source update should not rewrite a post you already published. A
                            shorter caption should not become everyone’s caption.
                        </p>
                        <p>
                            Herald keeps the shared post and each destination’s draft, schedule and
                            history together — without making them the same thing.
                        </p>
                        <Link href="/docs/concepts/">Explore the workflow</Link>
                    </div>
                </section>
                <section className="getting-started" aria-labelledby="start-title">
                    <div>
                        <h2 id="start-title">
                            Your next post
                            <br />
                            starts here.
                        </h2>
                        <p>Self-hosted. Open source. Built around your workflow.</p>
                    </div>
                    <div className="start-links">
                        <Link href="/docs/installation/">
                            Set up Herald <span aria-hidden="true">↗</span>
                        </Link>
                        <Link href="/docs/first-publication/">
                            Try a manual destination <span aria-hidden="true">↗</span>
                        </Link>
                        <Link href="/docs/automation/">
                            Work through the API <span aria-hidden="true">↗</span>
                        </Link>
                    </div>
                </section>
            </main>
            <footer className="site-footer">
                <span>Herald</span>
                <span>Preparing the first public alpha.</span>
                <Link href="/docs/">Documentation</Link>
            </footer>
        </div>
    )
}
