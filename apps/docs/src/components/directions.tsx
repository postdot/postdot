'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useState } from 'react'

import { directions, type DirectionStyle as Style } from '@/lib/directions'
import '@fontsource-variable/manrope'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/space-grotesk'

import './directions.css'
import './prism-system.css'

import { PostbotLogo } from './brand'
const labels = { prism: 'Prism', studio: 'Studio', signal: 'Signal' }
const image = (style: Style) => `/design/${style === 'studio' ? 'studio' : 'glass'}.webp`
const channels = ['Source', 'Bluesky', 'LinkedIn', 'Manual']
const copy = [
    'A little space for new ideas. Our new collection explores light, color and the things we make together.',
    'New work, new light. Our latest collection is here — a little space for new ideas.',
    'Our new collection is an exploration of light and color. Today we are sharing the work, and the people and ideas behind it.',
    'A little space for new ideas. Discover the new collection at our open studio this Friday.',
]

function Brand() {
    return (
        <Link href="/" className="d-brand">
            <PostbotLogo />
            Postbot
        </Link>
    )
}
function Comparison({ current }: { current?: Style }) {
    return (
        <nav className="d-comparison" aria-label="Design directions">
            <Link href="/">Directions</Link>
            {directions
                .filter(style => style !== 'signal')
                .map(style => (
                    <Link
                        key={style}
                        href={`/directions/${style}/`}
                        aria-current={current === style ? 'page' : undefined}>
                        {labels[style]}
                    </Link>
                ))}
        </nav>
    )
}
function Header({ style }: { style: Style }) {
    return (
        <header className="d-header">
            <Brand />
            <nav aria-label="Main navigation">
                <a href="#workflow">Product</a>
                {style === 'prism' && (
                    <Link href="/directions/prism/workspace/">Workspace study</Link>
                )}
                <Link href="/docs/">Docs</Link>
                <Link className="d-small-cta" href="/docs/installation/">
                    Get started
                </Link>
            </nav>
        </header>
    )
}
function Buttons({ studio = false }: { studio?: boolean }) {
    return (
        <div className="d-actions">
            <Link className="d-button" href="/docs/installation/">
                Start with Postbot <span aria-hidden="true">↗</span>
            </Link>
            <a className="d-text-link" href="#workflow">
                {studio ? 'Take a look around' : 'Explore the workflow'}
            </a>
        </div>
    )
}
function Campaign({ style, compact = false }: { style: Style; compact?: boolean }) {
    return (
        <div className={`d-campaign ${compact ? 'is-compact' : ''}`}>
            <img
                src={image(style)}
                alt={
                    style === 'studio'
                        ? 'Sunlit lavender architecture beside a blue pool'
                        : 'Cobalt glass and lilac paper, photographed in sunlight'
                }
                width="1536"
                height="1024"
            />
            <div className="d-campaign-caption">
                <span>Form & Field</span>
                <span>New collection</span>
            </div>
        </div>
    )
}
function Product({ style }: { style: Style }) {
    const [selected, setSelected] = useState(0)
    const reduced = useReducedMotion()
    return (
        <figure className="d-product">
            <div className="d-window-bar">
                <span className="d-window-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </span>
                <span>Form & Field / New collection</span>
                <span className="d-example">Workflow example</span>
            </div>
            <div className="d-workspace">
                <aside className="d-product-rail">
                    <PostbotLogo />
                    <span className="is-active">Compose</span>
                    <span>Calendar</span>
                    <span>Media</span>
                    <span>Channels</span>
                    <div className="d-rail-end">
                        Form & Field<span>Project</span>
                    </div>
                </aside>
                <div className="d-compose">
                    <div className="d-compose-title">
                        <div>
                            <span className="d-muted">Post</span>
                            <h3>A little space for new ideas</h3>
                        </div>
                        <span className="d-saved">
                            <i />
                            Saved
                        </span>
                    </div>
                    <div
                        className="d-tabs"
                        role="group"
                        aria-label="Example publication destination">
                        {channels.map((channel, i) => (
                            <button
                                key={channel}
                                aria-pressed={selected === i}
                                onClick={() => setSelected(i)}>
                                {i > 0 && (
                                    <span aria-hidden="true" className={`d-channel-mark mark-${i}`}>
                                        {channel[0]}
                                    </span>
                                )}
                                {channel}
                            </button>
                        ))}
                    </div>
                    <div className="d-compose-body">
                        <div className="d-writing">
                            <span className="d-muted">
                                {selected ? `${channels[selected]} adaptation` : 'Shared source'}
                            </span>
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.p
                                    key={selected}
                                    initial={{ opacity: 0, y: reduced ? 0 : 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: reduced ? 0 : 0.16 }}>
                                    {copy[selected]}
                                </motion.p>
                            </AnimatePresence>
                            <img
                                src={image(style)}
                                width="1536"
                                height="1024"
                                alt="Campaign media attached to the example post"
                                loading="lazy"
                            />
                            <div className="d-writing-footer">
                                <span>Photo attached</span>
                                <span>Saved draft</span>
                            </div>
                        </div>
                        <div className="d-destinations">
                            <span className="d-muted">Destinations</span>
                            {channels.slice(1).map((channel, i) => (
                                <button
                                    className="d-destination"
                                    key={channel}
                                    onClick={() => setSelected(i + 1)}
                                    aria-pressed={selected === i + 1}>
                                    <span
                                        aria-hidden="true"
                                        className={`d-channel-mark mark-${i + 1}`}>
                                        {channel[0]}
                                    </span>
                                    <div>
                                        <strong>{channel}</strong>
                                        <span>
                                            {i === 2
                                                ? 'Ready for your next step'
                                                : `Friday · ${i === 0 ? '09:00' : '11:30'}`}
                                        </span>
                                    </div>
                                    <i className={i === 2 ? 'd-manual-dot' : 'd-schedule-dot'} />
                                </button>
                            ))}
                            <div className="d-independent">
                                <span className="d-mini-stack" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                                <p>
                                    One source.
                                    <br />A draft for each destination.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <figcaption>Select a destination to explore its adaptation.</figcaption>
        </figure>
    )
}
function SignalField() {
    return (
        <div className="d-signal-field" aria-hidden="true">
            <svg viewBox="0 0 600 500">
                <defs>
                    <radialGradient id="signal-glow">
                        <stop stopColor="#899dff" stopOpacity=".6" />
                        <stop offset="1" stopColor="#5684ff" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="signal-line">
                        <stop stopColor="#aaa8ff" />
                        <stop offset="1" stopColor="#ecb98a" />
                    </linearGradient>
                </defs>
                <ellipse cx="300" cy="250" rx="260" ry="240" fill="url(#signal-glow)" />
                {Array.from({ length: 14 }, (_, i) => (
                    <ellipse
                        key={i}
                        cx="300"
                        cy="250"
                        rx={70 + i * 13}
                        ry={42 + i * 11}
                        transform={`rotate(-32 300 250)`}
                        fill="none"
                        stroke="url(#signal-line)"
                        strokeWidth=".8"
                        opacity={0.85 - i * 0.04}
                    />
                ))}
                <circle cx="140" cy="280" r="6" fill="#ecb98a" />
                <circle cx="448" cy="220" r="8" fill="#aaa8ff" />
            </svg>
            <PostbotLogo />
            <span className="d-field-label field-one">Your source</span>
            <span className="d-field-label field-two">Every destination</span>
        </div>
    )
}
function Ownership({ style }: { style: Style }) {
    const [tab, setTab] = useState(0)
    return (
        <section className="d-ownership">
            <div className="d-own-copy">
                <h2>
                    Your work.
                    <br />
                    Your own space.
                </h2>
                <p>Keep your media, drafts and publishing history on infrastructure you control.</p>
                <Link className="d-text-link" href="/docs/operations/">
                    Built for self-hosting
                </Link>
            </div>
            <div className="d-infrastructure">
                <div
                    className="d-own-tabs"
                    role="group"
                    aria-label="Explore self-hosting capabilities">
                    {['Media', 'History', 'Access'].map((name, i) => (
                        <button key={name} aria-pressed={tab === i} onClick={() => setTab(i)}>
                            {name}
                        </button>
                    ))}
                </div>
                {tab === 0 ? (
                    <div className="d-media-shelf">
                        <img
                            src={image(style)}
                            alt="Campaign image in your media library"
                            width="1536"
                            height="1024"
                            loading="lazy"
                        />
                        <div className="d-media-file">
                            <span className="d-file-shape" aria-hidden="true" />
                            <strong>new-collection.jpg</strong>
                            <span>Original + internal previews</span>
                            <span className="d-file-note">Your media stays with you.</span>
                        </div>
                    </div>
                ) : tab === 1 ? (
                    <div className="d-history">
                        <h3>A clear trail.</h3>
                        <p>
                            Draft saved <span>08:42</span>
                        </p>
                        <p>
                            Bluesky scheduled <span>09:00</span>
                        </p>
                        <p>
                            Manual destination recorded <span>09:15</span>
                        </p>
                        <Link href="/docs/concepts/">Understand publication states</Link>
                    </div>
                ) : (
                    <div className="d-history">
                        <h3>A place for your team.</h3>
                        <p>
                            Owner <span>Manage the project</span>
                        </p>
                        <p>
                            Editor <span>Prepare and publish</span>
                        </p>
                        <p>
                            Viewer <span>Read and follow along</span>
                        </p>
                        <Link href="/docs/automation/">Explore scoped API access</Link>
                    </div>
                )}
            </div>
        </section>
    )
}
function DocsEntry() {
    return (
        <section className="d-docs-entry" id="documentation">
            <div className="d-docs-copy">
                <span className="d-book-glyph" aria-hidden="true">
                    <i />
                    <i />
                </span>
                <h2>
                    From first install
                    <br />
                    to your next post.
                </h2>
                <p>A practical path into Postbot.</p>
                <Link className="d-button" href="/docs/">
                    Open the docs <span aria-hidden="true">↗</span>
                </Link>
            </div>
            <div className="d-docs-preview">
                <aside>
                    <Brand />
                    <span className="d-current">Getting started</span>
                    <Link href="/docs/installation/">Installation</Link>
                    <Link href="/docs/first-publication/">Your first publication</Link>
                    <Link href="/docs/providers/">Provider connections</Link>
                    <Link href="/docs/media/">Media</Link>
                </aside>
                <div className="d-guide">
                    <span className="d-muted">Getting started</span>
                    <h3>Your first publication</h3>
                    <p>
                        Create a project. Add a destination.
                        <br />
                        Give your next idea a place to go.
                    </p>
                    <div className="d-guide-image">
                        <div className="d-guide-steps">
                            <span>
                                Project <strong>Form &amp; Field</strong>
                            </span>
                            <span>
                                Channel <strong>Manual destination</strong>
                            </span>
                            <span>
                                Publication <strong>Your first draft</strong>
                            </span>
                        </div>
                    </div>
                    <Link href="/docs/first-publication/">
                        Read the guide <span aria-hidden="true">↗</span>
                    </Link>
                </div>
            </div>
        </section>
    )
}
function Footer() {
    return (
        <footer className="d-footer">
            <div>
                <Brand />
                <span>Independent publishing. Open source.</span>
            </div>
            <nav aria-label="Footer">
                <Link href="/docs/">Documentation</Link>
                <Link href="/docs/installation/">Self-hosting</Link>
                <Link href="/docs/automation/">API & CLI</Link>
            </nav>
            <small>Public launch in preparation.</small>
        </footer>
    )
}
export function Direction({ direction: style }: { direction: Style }) {
    return (
        <div className={`design-page direction-${style}`}>
            <a className="d-skip" href="#main">
                Skip to content
            </a>
            <Header style={style} />
            <main id="main">
                {style === 'prism' ? (
                    <section className="d-hero prism-hero">
                        <div className="d-prism-light" aria-hidden="true" />
                        <h1>
                            Good ideas deserve
                            <br />
                            to travel.
                        </h1>
                        <p>
                            Compose once. Make it your own, everywhere.
                            <br />
                            The self-hosted home for your publishing.
                        </p>
                        <Buttons />
                        <div className="d-prism-stage">
                            <Product style={style} />
                        </div>
                    </section>
                ) : style === 'studio' ? (
                    <section className="d-hero studio-hero">
                        <div className="d-studio-heading">
                            <h1>
                                Make it.
                                <br />
                                Share it.
                                <br />
                                Own it.
                            </h1>
                            <div>
                                <p>
                                    A home for what you have to say.
                                    <br />
                                    Across channels. On your terms.
                                </p>
                                <Buttons studio />
                            </div>
                        </div>
                        <div className="d-studio-scene">
                            <Campaign style={style} />
                            <div className="d-studio-note">
                                <PostbotLogo />
                                <p>
                                    A new collection.
                                    <br />
                                    Two directions to tell the story.
                                </p>
                                <span>Form & Field / Friday</span>
                            </div>
                        </div>
                    </section>
                ) : (
                    <section className="d-hero signal-hero">
                        <div>
                            <span className="d-status">
                                <i />
                                Independent by design
                            </span>
                            <h1>
                                Your voice.
                                <br />
                                Full reach.
                                <br />
                                Your rules.
                            </h1>
                            <p>
                                Bring every destination into focus.
                                <br />A publishing workspace you can host yourself.
                            </p>
                            <Buttons />
                        </div>
                        <SignalField />
                    </section>
                )}
                <section className="d-workflow" id="workflow">
                    <div className="d-section-heading">
                        <h2>
                            {style === 'studio'
                                ? 'Same idea.\nDifferent conversations.'
                                : style === 'signal'
                                  ? 'One origin.\nEvery possibility.'
                                  : 'A shared starting point.\nRoom for every channel.'}
                        </h2>
                        <p>
                            Different words, images and schedules.
                            <br />
                            Connected by the same idea.
                        </p>
                    </div>
                    {style === 'prism' ? (
                        <div className="d-adaptation-strip">
                            <span>Bluesky</span>
                            <span>LinkedIn</span>
                            <span>Mastodon</span>
                            <span>Discord</span>
                            <span>Manual destinations</span>
                        </div>
                    ) : (
                        <Product style={style} />
                    )}
                    {style === 'prism' && (
                        <div className="d-prism-detail">
                            <Campaign style={style} />
                            <div>
                                <span className="d-muted">A draft of its own</span>
                                <h3>
                                    Let each version
                                    <br />
                                    find its voice.
                                </h3>
                                <p>
                                    Adapt the shared source for a destination without rewriting the
                                    others.
                                </p>
                                <Link className="d-text-link" href="/docs/concepts/">
                                    See how it fits together
                                </Link>
                            </div>
                        </div>
                    )}
                </section>
                <Ownership style={style} />
                <DocsEntry />
                <section className="d-final">
                    <PostbotLogo />
                    <h2>
                        Give your next idea
                        <br />a place to go.
                    </h2>
                    <Link className="d-button" href="/docs/installation/">
                        Start with Postbot <span aria-hidden="true">↗</span>
                    </Link>
                </section>
            </main>
            <Footer />
            <Comparison current={style} />
        </div>
    )
}
export function DirectionGallery() {
    return (
        <div className="d-gallery">
            <header>
                <Brand />
                <Link href="/docs/">Documentation</Link>
            </header>
            <main>
                <h1>
                    Two directions
                    <br />
                    to see Postbot.
                </h1>
                <p>Typography. Material. Rhythm. A complete direction for each.</p>
                <div className="d-gallery-list">
                    {directions
                        .filter(style => style !== 'signal')
                        .map(style => (
                            <Link
                                className={`d-gallery-card direction-${style}`}
                                key={style}
                                href={`/directions/${style}/`}>
                                <div className="d-gallery-art">
                                    <img src={image(style)} width="1536" height="1024" alt="" />
                                    <span>
                                        {style === 'prism'
                                            ? 'Good ideas deserve to travel.'
                                            : style === 'studio'
                                              ? 'Make it. Share it. Own it.'
                                              : 'Your voice. Full reach. Your rules.'}
                                    </span>
                                </div>
                                <div className="d-gallery-caption">
                                    <h2>{labels[style]}</h2>
                                    <p>
                                        {style === 'prism'
                                            ? 'Light, glass and product depth.'
                                            : style === 'studio'
                                              ? 'Image-led, expressive and independent.'
                                              : 'Dark, precise and broadcast-inspired.'}
                                    </p>
                                    <span aria-hidden="true">↗</span>
                                </div>
                            </Link>
                        ))}
                </div>
            </main>
        </div>
    )
}
