'use client'

import { Button } from '@postbot/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@postbot/ui/components/tabs'
import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { Accordion as FAQItem, Accordions as FAQ } from 'fumadocs-ui/components/accordion'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { PublicScreenshot } from './public-screenshot'
import { PublicWordmark } from './public-wordmark'

function Scene({ children, className = '' }: { children: ReactNode; className?: string }) {
    const reducedMotion = useReducedMotion()
    return (
        <motion.div
            className={`home-scene ${className}`}
            initial={false}
            whileInView={{ y: 0 }}
            style={{ y: reducedMotion ? 0 : 32 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}>
            {children}
        </motion.div>
    )
}

const commands = [
    {
        value: 'prepare',
        label: 'Prepare',
        command: 'bun run postbot posts create --project "$PROJECT_ID" --input post.json --json',
        description: 'Create a source post and its destination drafts from a JSON file.',
    },
    {
        value: 'inspect',
        label: 'Inspect',
        command:
            'bun run postbot publications show --project "$PROJECT_ID" --publication "$PUBLICATION_ID" --json',
        description: 'Read the source, destination draft and execution state before acting.',
    },
    {
        value: 'schedule',
        label: 'Schedule',
        command:
            'bun run postbot publications promote --project "$PROJECT_ID" --publication "$PUBLICATION_ID" --expected-revision 1 --at "$EPOCH_MS" --json',
        description:
            'Promote the inspected revision for the chosen time, within the permissions you granted.',
    },
]

const questions = [
    {
        title: 'Do I need an AI agent?',
        answer: 'No. You can write, adapt and manage publications entirely in the web app. The CLI and REST API give your existing agents and scripts another way to work with the same posts.',
    },
    {
        title: 'Does Postbot generate content?',
        answer: 'Postbot does not contain a built-in AI writer. Your own agent can prepare content and create drafts through the CLI or API. You choose its access and what it is allowed to do.',
    },
    {
        title: 'Which destinations can I connect?',
        answer: 'Bluesky, Discord, LinkedIn, Mastodon, X and DEV.to, plus manual and custom HTTP destinations. Available content types and connection requirements vary by provider.',
    },
    {
        title: 'Where does Postbot run?',
        answer: 'On infrastructure you manage. The installation guide uses Docker Compose from a source checkout, with local media storage by default and optional S3-compatible storage.',
    },
]

function AgentCommands() {
    const [value, setValue] = useState('prepare')
    const [copied, setCopied] = useState(false)
    const [copyFailed, setCopyFailed] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])
    const active = commands.find(command => command.value === value) ?? commands[0]
    async function copy() {
        if (!active) return
        try {
            await navigator.clipboard.writeText(active.command)
            setCopyFailed(false)
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopyFailed(true)
            setCopied(false)
        }
    }
    return (
        <Tabs
            value={value}
            onValueChange={next => {
                setValue(String(next))
                setCopied(false)
            }}
            className="home-agent-terminal">
            <div className="home-agent-terminal-top">
                <TabsList className="home-terminal-tabs">
                    {commands.map(command => (
                        <TabsTrigger key={command.value} value={command.value}>
                            {command.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <Button variant="ghost" className="home-command-copy" onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </div>
            {commands.map(command => (
                <TabsContent key={command.value} value={command.value}>
                    <pre>
                        <code>{command.command}</code>
                    </pre>
                    <p>{command.description}</p>
                </TabsContent>
            ))}
            <div className="home-agent-terminal-bottom">
                <span>CLI · source checkout</span>
                <span aria-live="polite">
                    {copied
                        ? 'Command copied'
                        : copyFailed
                          ? 'Select the command to copy it manually'
                          : 'Project roles and key permissions apply'}
                </span>
            </div>
        </Tabs>
    )
}

export function PublicStory() {
    const poster = useRef<HTMLDivElement>(null)
    const reducedMotion = useReducedMotion()
    const { scrollYProgress } = useScroll({ target: poster, offset: ['start end', 'end start'] })
    const rotate = useTransform(scrollYProgress, [0, 0.5, 1], [-4, 0, 2])
    return (
        <div className="home-product-story">
            <section id="workflow" className="home-chapter home-workflow-chapter">
                <div className="home-chapter-heading">
                    <h2>
                        Start with a draft.
                        <br />
                        Make it yours.
                    </h2>
                    <p>
                        Write it yourself, or let your agent prepare it. Review the source and give
                        each destination the content it needs, all in one workspace.
                    </p>
                </div>
                <Scene>
                    <PublicScreenshot name="post" title="Post and destinations" />
                </Scene>
                <div className="home-workflow-notes">
                    <div>
                        <h3>One source to come back to.</h3>
                        <p>
                            Keep the shared text and media together. Updating them does not rewrite
                            destination adaptations or past publications.
                        </p>
                    </div>
                    <div>
                        <h3>A version for each destination.</h3>
                        <p>
                            Adapt wording, media and dates independently. A community update does
                            not have to be a copy of your newsletter.
                        </p>
                    </div>
                </div>
                <Scene className="home-adaptation-spread">
                    <motion.div
                        ref={poster}
                        className="home-adaptation-poster"
                        style={{ rotate: reducedMotion ? 0 : rotate }}>
                        <img
                            src="/product/studio-poster.webp"
                            alt="Example open-studio event poster"
                            width={1000}
                            height={1200}
                            loading="lazy"
                        />
                    </motion.div>
                    <div className="home-adaptation-writing">
                        <span className="home-example-note">Example adaptations</span>
                        <div>
                            <span>Studio updates</span>
                            <h3>The studio doors are open this Saturday.</h3>
                            <p>
                                Meet the makers, explore the collection and stay for a conversation.
                            </p>
                        </div>
                        <div>
                            <span>Community</span>
                            <h3>Come by. Stay a while.</h3>
                            <p>
                                Open studio, Saturday 24 October.
                                <br />
                                We would love to see you.
                            </p>
                        </div>
                    </div>
                </Scene>
            </section>
            <section id="planning" className="home-chapter home-planning-chapter">
                <div className="home-chapter-heading home-heading-split">
                    <h2>
                        See what is going out.
                        <br />
                        And what still needs you.
                    </h2>
                    <p>
                        Plan across destinations, then follow each publication. Your calendar and
                        queue show timing and state from the same workspace.
                    </p>
                </div>
                <Scene>
                    <Tabs defaultValue="queue" className="home-planning-tabs">
                        <TabsList className="home-view-tabs" aria-label="Product views">
                            <TabsTrigger value="queue">Queue</TabsTrigger>
                            <TabsTrigger value="calendar">Calendar</TabsTrigger>
                        </TabsList>
                        <TabsContent value="calendar">
                            <PublicScreenshot name="calendar" title="Publication calendar" />
                        </TabsContent>
                        <TabsContent value="queue">
                            <PublicScreenshot name="queue" title="Publication queue" />
                        </TabsContent>
                    </Tabs>
                </Scene>
                <p className="home-scene-caption">
                    The real Postbot interface, shown with an example project.
                </p>
            </section>
            <section id="automation" className="home-automation-chapter">
                <div className="home-automation-inner">
                    <div className="home-chapter-heading home-heading-split">
                        <h2>
                            Your agents.
                            <br />
                            The same workspace.
                        </h2>
                        <p>
                            Use the tools your agents already understand. Postbot exposes the
                            publication workflow through its CLI and REST API, without handing them
                            your provider credentials.
                        </p>
                    </div>
                    <Scene>
                        <AgentCommands />
                    </Scene>
                    <div className="home-agent-notes">
                        <p>Prepare drafts. Inspect state. Schedule a reviewed revision.</p>
                        <Link href="/docs/automation/">
                            Explore the automation interface{' '}
                            <ArrowRightIcon size={18} aria-hidden="true" />
                        </Link>
                    </div>
                </div>
            </section>
            <section id="self-hosting" className="home-chapter home-ownership-chapter">
                <div className="home-ownership-copy">
                    <h2>
                        Your posts belong
                        <br />
                        in your workspace.
                    </h2>
                    <p>
                        Postbot is open source and self-hosted. Your posts, media and connections
                        stay on infrastructure you manage.
                    </p>
                    <Link href="/docs/installation/" className="home-inline-action">
                        Install Postbot <ArrowRightIcon size={18} aria-hidden="true" />
                    </Link>
                </div>
                <Scene className="home-hosting-scene">
                    <div className="home-hosting-clients">
                        <span>Web app</span>
                        <span>Your agents</span>
                    </div>
                    <svg className="home-hosting-routes" viewBox="0 0 440 72" aria-hidden="true">
                        <path d="M100 0v30q0 10 10 10h100q10 0 10 10v22M340 0v30q0 10-10 10H230q-10 0-10 10" />
                    </svg>
                    <div className="home-hosting-server">
                        <PublicWordmark />
                        <span>On your infrastructure</span>
                        <div>
                            <span>Posts</span>
                            <span>Media</span>
                            <span>Connections</span>
                        </div>
                    </div>
                </Scene>
            </section>
            <section className="home-chapter home-questions">
                <h2>About running Postbot</h2>
                <FAQ className="home-faq" multiple>
                    {questions.map((question, index) => (
                        <FAQItem
                            key={question.title}
                            title={question.title}
                            value={String(index)}
                            className="home-faq-item">
                            {question.answer}
                        </FAQItem>
                    ))}
                </FAQ>
            </section>
        </div>
    )
}
