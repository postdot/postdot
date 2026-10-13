'use client'

import Link from 'next/link'
import { useState } from 'react'
import '@fontsource-variable/manrope'

import { PostbotLogo } from './brand'

import './prism-system.css'

type Screen = 'Calendar' | 'Queue' | 'Compose' | 'Media'
type Entry = {
    day: number
    title: string
    channel: string
    status: 'Scheduled' | 'Manual' | 'Draft'
    time: string
}
const entries: Entry[] = [
    {
        day: 8,
        title: 'A little space for new ideas',
        channel: 'Bluesky',
        status: 'Scheduled',
        time: '09:00',
    },
    {
        day: 9,
        title: 'Introducing the collection',
        channel: 'LinkedIn',
        status: 'Scheduled',
        time: '11:30',
    },
    {
        day: 12,
        title: 'Open studio this Friday',
        channel: 'Newsletter',
        status: 'Manual',
        time: '10:00',
    },
    { day: 14, title: 'Behind the glass', channel: 'Bluesky', status: 'Draft', time: '' },
    {
        day: 19,
        title: 'Made with a little more light',
        channel: 'Mastodon',
        status: 'Scheduled',
        time: '14:00',
    },
]
function Brand() {
    return (
        <Link className="p-brand" href="/directions/prism/">
            <PostbotLogo />
            Postbot
        </Link>
    )
}
function Switcher({ surface }: { surface: string }) {
    return (
        <nav className="p-switcher" aria-label="Prism surfaces">
            <Link href="/directions/prism/">Landing</Link>
            <Link
                href="/directions/prism/workspace/"
                aria-current={surface === 'workspace' ? 'page' : undefined}>
                Workspace
            </Link>
            <Link
                href="/directions/prism/documentation/"
                aria-current={surface === 'documentation' ? 'page' : undefined}>
                Documentation
            </Link>
        </nav>
    )
}
function Status({ entry }: { entry: Entry }) {
    return (
        <span className={`p-status p-status-${entry.status.toLowerCase()}`}>
            <i />
            {entry.status}
        </span>
    )
}
function Inspector({ entry, onClose }: { entry: Entry; onClose: () => void }) {
    return (
        <aside className="p-inspector" aria-label="Publication preview">
            <div className="p-inspector-head">
                <span>Publication</span>
                <button onClick={onClose}>Close</button>
            </div>
            <img
                src="/design/glass.webp"
                width="1536"
                height="1024"
                alt="Cobalt glass campaign photograph"
            />
            <Status entry={entry} />
            <h2>{entry.title}</h2>
            <p>
                New work, new light. Our latest collection is here — a little space for new ideas.
            </p>
            <dl>
                <div>
                    <dt>Channel</dt>
                    <dd>{entry.channel}</dd>
                </div>
                <div>
                    <dt>Schedule</dt>
                    <dd>
                        October {entry.day}
                        {entry.time && `, ${entry.time}`}
                    </dd>
                </div>
                <div>
                    <dt>Source</dt>
                    <dd>New collection</dd>
                </div>
            </dl>
            <span className="p-specimen-note">Illustrative publication</span>
        </aside>
    )
}
function Workspace() {
    const [screen, setScreen] = useState<Screen>('Calendar')
    const [selected, setSelected] = useState<Entry | null>(null)
    const [query, setQuery] = useState('')
    const [text, setText] = useState(
        'A little space for new ideas. Our new collection explores light, color and the things we make together.'
    )
    const [month, setMonth] = useState(10)
    const [year, setYear] = useState(2026)
    const visible = entries.filter(entry =>
        `${entry.title} ${entry.channel}`.toLowerCase().includes(query.toLowerCase())
    )
    const first = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const next = (delta: number) => {
        const date = new Date(Date.UTC(year, month - 1 + delta, 1))
        setMonth(date.getUTCMonth() + 1)
        setYear(date.getUTCFullYear())
        setSelected(null)
    }
    return (
        <div className="p-workspace">
            <aside className="p-sidebar">
                <Brand />
                <div className="p-project">
                    <span className="p-project-image">F</span>
                    <div>
                        Form &amp; Field<small>Project workspace</small>
                    </div>
                </div>
                <nav aria-label="Workspace">
                    {(['Calendar', 'Queue', 'Compose', 'Media'] as Screen[]).map(name => (
                        <button
                            key={name}
                            onClick={() => {
                                setScreen(name)
                                setSelected(null)
                            }}
                            aria-current={screen === name ? 'page' : undefined}>
                            <span className="p-nav-marker" />
                            {name}
                        </button>
                    ))}
                </nav>
                <div className="p-sidebar-end">
                    <span className="p-avatar">HS</span>
                    <div>
                        Hakim<small>Project owner</small>
                    </div>
                </div>
            </aside>
            <div className="p-workspace-main">
                <header className="p-app-header">
                    <span>
                        Form &amp; Field <span>/ {screen}</span>
                    </span>
                    {(screen === 'Calendar' || screen === 'Queue') && (
                        <label className="p-search">
                            <span className="p-search-glyph" aria-hidden="true" />
                            <input
                                placeholder="Filter publications…"
                                aria-label="Filter publications"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                            />
                        </label>
                    )}
                </header>
                <div className={`p-app-body ${selected ? 'has-inspector' : ''}`}>
                    <main className="p-task">
                        <div className="p-title-row">
                            <div>
                                <span className="p-overview-context">Your publishing</span>
                                <h1>{screen === 'Calendar' ? 'Overview' : screen}</h1>
                            </div>
                            {screen !== 'Compose' && (
                                <button
                                    className="p-primary"
                                    onClick={() => {
                                        setScreen('Compose')
                                        setSelected(null)
                                    }}>
                                    New post
                                </button>
                            )}
                        </div>
                        {screen === 'Calendar' ? (
                            <>
                                <div className="p-calendar-toolbar">
                                    <h2>
                                        {new Date(Date.UTC(year, month - 1)).toLocaleDateString(
                                            'en',
                                            { month: 'long', year: 'numeric', timeZone: 'UTC' }
                                        )}
                                    </h2>
                                    <div>
                                        <button
                                            onClick={() => next(-1)}
                                            aria-label="Previous month">
                                            ‹
                                        </button>
                                        <button
                                            onClick={() => {
                                                setMonth(10)
                                                setYear(2026)
                                            }}>
                                            October
                                        </button>
                                        <button onClick={() => next(1)} aria-label="Next month">
                                            ›
                                        </button>
                                    </div>
                                </div>
                                <div className="p-calendar">
                                    <div className="p-weekdays">
                                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                                            day => (
                                                <span key={day}>{day}</span>
                                            )
                                        )}
                                    </div>
                                    <div className="p-days">
                                        {Array.from(
                                            { length: Math.ceil((first + count) / 7) * 7 },
                                            (_, i) => {
                                                const day = i - first + 1
                                                const active = day > 0 && day <= count
                                                return (
                                                    <div
                                                        className={`p-day ${!active ? 'p-day-outside' : ''}`}
                                                        key={i}>
                                                        <span
                                                            className={
                                                                day === 11 &&
                                                                month === 10 &&
                                                                year === 2026
                                                                    ? 'p-today'
                                                                    : ''
                                                            }>
                                                            {active ? day : ''}
                                                        </span>
                                                        {active &&
                                                            month === 10 &&
                                                            year === 2026 &&
                                                            visible
                                                                .filter(e => e.day === day)
                                                                .map(entry => (
                                                                    <button
                                                                        key={entry.title}
                                                                        className={`p-event p-event-${entry.status.toLowerCase()}`}
                                                                        onClick={() =>
                                                                            setSelected(entry)
                                                                        }>
                                                                        <small>
                                                                            {entry.time || 'Draft'}{' '}
                                                                            · {entry.channel}
                                                                        </small>
                                                                        <strong>
                                                                            {entry.title}
                                                                        </strong>
                                                                    </button>
                                                                ))}
                                                    </div>
                                                )
                                            }
                                        )}
                                    </div>
                                </div>
                                <div className="p-mobile-agenda">
                                    {month === 10 && year === 2026 ? (
                                        visible.map(entry => (
                                            <button
                                                className="p-queue-entry"
                                                key={entry.title}
                                                onClick={() => setSelected(entry)}>
                                                <time>
                                                    <strong>{entry.day}</strong>Oct
                                                </time>
                                                <div>
                                                    <strong>{entry.title}</strong>
                                                    <span>
                                                        {entry.channel} ·{' '}
                                                        {entry.time || 'Unscheduled'}
                                                    </span>
                                                </div>
                                                <Status entry={entry} />
                                            </button>
                                        ))
                                    ) : (
                                        <p>No sample publications this month.</p>
                                    )}
                                </div>
                                <div className="p-calendar-note">
                                    <span>
                                        <i />
                                        Scheduled
                                    </span>
                                    <span>
                                        <i />
                                        Manual destination
                                    </span>
                                    <span>
                                        <i />
                                        Draft
                                    </span>
                                </div>
                            </>
                        ) : screen === 'Queue' ? (
                            <div className="p-queue">
                                <p>Upcoming and ready for your next step.</p>
                                {visible.length === 0 ? (
                                    <p>No matching publications.</p>
                                ) : (
                                    visible.map(entry => (
                                        <button
                                            className="p-queue-entry"
                                            key={entry.title}
                                            onClick={() => setSelected(entry)}>
                                            <time>
                                                <strong>{entry.day}</strong>Oct
                                            </time>
                                            <div>
                                                <strong>{entry.title}</strong>
                                                <span>
                                                    {entry.channel} · {entry.time || 'Unscheduled'}
                                                </span>
                                            </div>
                                            <Status entry={entry} />
                                        </button>
                                    ))
                                )}
                            </div>
                        ) : screen === 'Compose' ? (
                            <div className="p-editor">
                                <div className="p-editor-heading">
                                    <h2>New collection</h2>
                                    <span>Local visual study</span>
                                </div>
                                <label htmlFor="p-source">Shared source</label>
                                <textarea
                                    id="p-source"
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                />
                                <img
                                    src="/design/glass.webp"
                                    width="1536"
                                    height="1024"
                                    alt="Attached campaign photograph"
                                />
                                <div className="p-editor-destinations">
                                    <span>Destinations</span>
                                    <button onClick={() => setSelected(entries[0]!)}>
                                        Bluesky <small>View adaptation</small>
                                    </button>
                                    <button onClick={() => setSelected(entries[1]!)}>
                                        LinkedIn <small>View adaptation</small>
                                    </button>
                                </div>
                                <p className="p-specimen-note">
                                    Text stays in this study only. Nothing is published or saved to
                                    Postbot.
                                </p>
                            </div>
                        ) : (
                            <div className="p-library">
                                {['glass', 'studio'].map((name, i) => (
                                    <figure key={name}>
                                        <img
                                            src={`/design/${name}.webp`}
                                            width="1536"
                                            height="1024"
                                            alt={
                                                i
                                                    ? 'Poolside campaign photograph'
                                                    : 'Cobalt glass campaign photograph'
                                            }
                                        />
                                        <figcaption>
                                            {i ? 'open-studio.webp' : 'new-collection.webp'}
                                            <small>Image · Original</small>
                                        </figcaption>
                                    </figure>
                                ))}
                            </div>
                        )}
                    </main>
                    {selected && <Inspector entry={selected} onClose={() => setSelected(null)} />}
                </div>
            </div>
        </div>
    )
}
function Documentation() {
    return (
        <div className="p-documentation">
            <header>
                <Brand />
                <nav>
                    <Link href="/directions/prism/">Product</Link>
                    <Link href="/docs/installation/">Installation</Link>
                </nav>
            </header>
            <div className="p-doc-layout">
                <aside>
                    <span>Getting started</span>
                    <a className="is-current" href="#first-publication">
                        Your first publication
                    </a>
                    <Link href="/docs/installation/">Installation</Link>
                    <Link href="/docs/concepts/">Posts and destinations</Link>
                    <span>Working with Postbot</span>
                    <Link href="/docs/providers/">Provider connections</Link>
                    <Link href="/docs/media/">Media</Link>
                    <Link href="/docs/automation/">API and CLI</Link>
                    <Link href="/docs/operations/">Backups and updates</Link>
                </aside>
                <article id="first-publication">
                    <span className="p-doc-context">Getting started</span>
                    <h1>Your first publication</h1>
                    <p className="p-doc-intro">
                        Start with a manual destination. Prepare your first post before connecting a
                        provider.
                    </p>
                    <div className="p-doc-callout">
                        <PostbotLogo />
                        <p>
                            A post holds your source. Each destination has its own draft, schedule
                            and history.
                        </p>
                    </div>
                    <h2 id="project">Create your project</h2>
                    <p>
                        Open Postbot and create a project. This is where your channels, media and
                        publications live.
                    </p>
                    <div className="p-doc-project">
                        <span className="p-project-image">F</span>
                        <div>
                            <strong>Form &amp; Field</strong>
                            <span>Your new project</span>
                        </div>
                        <span className="p-doc-ready">Ready</span>
                    </div>
                    <h2 id="destination">Add a destination</h2>
                    <p>
                        Create a manual channel. You can prepare and track a publication without
                        connecting an external account.
                    </p>
                    <div className="p-doc-path">
                        <span>Shared post</span>
                        <i aria-hidden="true" />
                        <span>Manual destination</span>
                    </div>
                    <h2 id="draft">Write your first draft</h2>
                    <p>
                        Compose your shared source, then adapt the destination if needed. Scheduling
                        keeps the next action visible in your calendar.
                    </p>
                    <blockquote>
                        “A little space for new ideas. Our new collection is here.”
                    </blockquote>
                    <h2 id="next">Make it your own</h2>
                    <p>
                        Connect a provider when you are ready for automated delivery. Your original
                        source and manual workflow stay together.
                    </p>
                    <Link className="p-doc-next" href="/docs/providers/">
                        <div>
                            <span>Next guide</span>
                            <strong>Provider connections</strong>
                        </div>
                        <span aria-hidden="true">↗</span>
                    </Link>
                </article>
                <nav className="p-on-this-page" aria-label="On this page">
                    <span>On this page</span>
                    <a href="#project">Create your project</a>
                    <a href="#destination">Add a destination</a>
                    <a href="#draft">Write your first draft</a>
                    <a href="#next">Make it your own</a>
                </nav>
            </div>
        </div>
    )
}
export function PrismStudy({ surface }: { surface: 'workspace' | 'documentation' }) {
    const [dark, setDark] = useState(false)
    return (
        <div className="prism-study" data-theme={dark ? 'dark' : 'light'}>
            <div className="p-study-bar">
                <span>
                    Prism / {surface === 'workspace' ? 'Application' : 'Documentation'} study ·
                    Sample content
                </span>
                <button onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'} appearance</button>
            </div>
            {surface === 'workspace' ? <Workspace /> : <Documentation />}
            <Switcher surface={surface} />
        </div>
    )
}
