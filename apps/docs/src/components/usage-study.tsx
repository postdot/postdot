'use client'

import { Button } from '@postbot/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@postbot/ui/components/tabs'
import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { ChatRoundDotsIcon } from '@solar-icons/react/linear/chat-round-dots'
import { PenNewRoundIcon } from '@solar-icons/react/linear/pen-new-round'
import { RestartIcon } from '@solar-icons/react/linear/restart'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { PostbotLogo } from './brand'
import { PublicThemeToggle } from './public-theme-toggle'

import './public-home.css'
import './usage-study.css'

const original =
    'Meet Postbot: an open-source, self-hosted workspace for social publishing. Prepare a post, adapt it for each network, and work directly or with your own agent.'
const paths = [
    ['Studio', 'Available'],
    ['CLI / API', 'Available'],
    ['MCP', 'Planned'],
    ['Agent skills', 'For launch'],
    ['n8n', 'Planned'],
    ['Mobile', 'Future'],
]

export function UsageStudy() {
    const [mode, setMode] = useState('agent')
    const [phase, setPhase] = useState<'ready' | 'preparing' | 'review'>('ready')
    const [text, setText] = useState(original)
    const editor = useRef<HTMLTextAreaElement>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const reduced = useReducedMotion()
    useEffect(() => () => clearTimeout(timer.current), [])
    function select(value: string) {
        clearTimeout(timer.current)
        setPhase('ready')
        setMode(value)
    }
    function prepare() {
        setPhase('preparing')
        timer.current = setTimeout(
            () => {
                setPhase('ready')
            },
            reduced ? 0 : 1050
        )
    }
    function review() {
        setPhase('review')
        requestAnimationFrame(() => editor.current?.focus())
    }
    return (
        <div className="public-home usage-study">
            <header className="usage-study-nav">
                <Link href="/" aria-label="Postbot home">
                    <PostbotLogo /> <span>postbot</span>
                </Link>
                <span>Section study</span>
                <PublicThemeToggle />
            </header>
            <main>
                <section className="usage-section" aria-labelledby="usage-title">
                    <div className="usage-heading">
                        <h1 id="usage-title">
                            Your agent can start it.
                            <br />
                            You can take it from there.
                        </h1>
                        <p>
                            Work directly in the Studio, or let your agent prepare the next draft.
                            It all stays in your workspace.
                        </p>
                    </div>
                    <Tabs
                        value={mode}
                        onValueChange={value => select(String(value))}
                        className="usage-demo">
                        <TabsList className="usage-entry" aria-label="Choose a way to work">
                            <TabsTrigger value="agent">
                                <ChatRoundDotsIcon size={18} /> Your agent
                            </TabsTrigger>
                            <TabsTrigger value="studio">
                                <PenNewRoundIcon size={18} /> Studio
                            </TabsTrigger>
                        </TabsList>
                        <div className="usage-stage" data-phase={phase}>
                            <div className="usage-entry-panel">
                                <TabsContent value="agent" className="usage-tab-panel">
                                    <div className="usage-request">
                                        <span className="usage-speaker">You</span>
                                        <p>
                                            Prepare a LinkedIn and Bluesky draft introducing
                                            Postbot. I’ll review it before anything goes live.
                                        </p>
                                    </div>
                                    <div className="usage-response">
                                        <span className="usage-agent-mark">
                                            <ChatRoundDotsIcon size={19} />
                                        </span>
                                        <div>
                                            <strong>Your agent</strong>
                                            <p role="status">
                                                {phase === 'preparing'
                                                    ? 'Preparing the draft…'
                                                    : 'The draft is ready in your workspace.'}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        className="usage-review"
                                        onClick={review}
                                        disabled={phase === 'preparing'}>
                                        Review in Studio <ArrowRightIcon size={17} />
                                    </Button>
                                    <button
                                        className="usage-replay"
                                        onClick={prepare}
                                        disabled={phase === 'preparing'}>
                                        <RestartIcon size={14} /> Replay preparation
                                    </button>
                                </TabsContent>
                                <TabsContent value="studio" className="usage-tab-panel">
                                    <div className="usage-direct-mark">
                                        <PenNewRoundIcon size={30} />
                                    </div>
                                    <h2>
                                        Your words.
                                        <br />
                                        Your next post.
                                    </h2>
                                    <p className="usage-direct-copy">
                                        Start writing, change a detail, or pick up a draft your
                                        agent prepared.
                                    </p>
                                    <Button className="usage-review" onClick={review}>
                                        Edit the draft <ArrowRightIcon size={17} />
                                    </Button>
                                </TabsContent>
                            </div>
                            <div className="usage-connection" aria-hidden="true">
                                <span />
                                <i />
                            </div>
                            <motion.div
                                className="usage-draft"
                                initial={false}
                                animate={{ opacity: phase === 'preparing' ? 0.55 : 1 }}
                                transition={{ duration: reduced ? 0 : 0.25 }}>
                                <div className="usage-draft-head">
                                    <span>
                                        <PostbotLogo /> Postbot
                                    </span>
                                    <span className="usage-draft-state">Draft</span>
                                </div>
                                <div className="usage-draft-body">
                                    <div
                                        className="usage-cover"
                                        aria-label="Postbot introduction artwork">
                                        <PostbotLogo />
                                        <span>
                                            Meet
                                            <br />
                                            <strong>postbot.</strong>
                                        </span>
                                    </div>
                                    <label className="sr-only" htmlFor="usage-draft-text">
                                        Example draft content
                                    </label>
                                    <textarea
                                        ref={editor}
                                        id="usage-draft-text"
                                        value={text}
                                        onChange={event => setText(event.target.value)}
                                        readOnly={phase !== 'review'}
                                        spellCheck={false}
                                    />
                                </div>
                                <div className="usage-draft-foot">
                                    <span className="usage-destinations">
                                        <span>LinkedIn</span>
                                        <span>Bluesky</span>
                                    </span>
                                    <span>
                                        {phase === 'review'
                                            ? 'Ready for your edits'
                                            : 'Saved as a draft'}
                                    </span>
                                </div>
                            </motion.div>
                        </div>
                    </Tabs>
                    <p className="usage-example-note">
                        Interactive example · edits stay in this page. Nothing is published.
                    </p>
                    <div
                        className="usage-access"
                        aria-label="Postbot access surfaces and availability">
                        <p>More ways into the same workspace.</p>
                        <ul>
                            {paths.map(([name, status]) => (
                                <li key={name} data-current={status === 'Available'}>
                                    <strong>{name}</strong>
                                    <span>{status}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>
            </main>
        </div>
    )
}
