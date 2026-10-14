'use client'

import linkedin from '@iconify-icons/logos/linkedin-icon'
import x from '@iconify-icons/logos/x'
import { Button } from '@postbot/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@postbot/ui/components/tabs'
import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { Accordion as FAQItem, Accordions as FAQ } from 'fumadocs-ui/components/accordion'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { PostbotLogo } from './brand'
import { PublicScreenshot } from './public-screenshot'

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
    {
        title: 'Can I use my existing AI tools?',
        answer: 'Yes, if they can run CLI commands or call a REST API. Give the integration a scoped API key. Postbot does not require a particular model or AI subscription. A dedicated MCP server is not available yet.',
    },
    {
        title: 'Will creating a draft publish it?',
        answer: 'No. Draft creation and publication are separate actions. A destination must be explicitly promoted for delivery. Give agents only the actions they need when creating their API keys.',
    },
    {
        title: 'Can each network have different content?',
        answer: 'Yes. A post has shared source content and separate destination drafts. Text, media and scheduling can be adapted for each destination without changing a previous publication.',
    },
    {
        title: 'Do I need developer accounts for the networks?',
        answer: 'Some connections need provider application configuration or credentials. Requirements differ between networks, and a provider may apply its own access limits or charges. The connection guides explain what is needed.',
    },
    {
        title: 'Can I keep images and videos in S3?',
        answer: 'Yes. Postbot supports S3-compatible media storage as well as local storage. Display previews are separate from the original files used for publishing.',
    },
    {
        title: 'Who handles backups?',
        answer: 'You operate and back up your installation. The operations guide covers the database, media and configuration needed to restore a workspace. Postbot does not replace your infrastructure backup system.',
    },
]

function AgentCommands() {
    const reduced = useReducedMotion()
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
                    <div className="home-agent-demo">
                        <div className="home-agent-request">
                            <span>Your agent · illustrative request</span>
                            <p>
                                {command.value === 'prepare'
                                    ? 'Prepare the weekend ride announcement for X and LinkedIn.'
                                    : command.value === 'inspect'
                                      ? 'Read the draft and its destinations before scheduling.'
                                      : 'Schedule the reviewed revision for Saturday.'}
                            </p>
                            <div className="home-agent-step-track" aria-label="Example workflow">
                                {commands.map((step, index) => (
                                    <span
                                        key={step.value}
                                        data-current={step.value === command.value}>
                                        {index + 1} <strong>{step.label}</strong>
                                    </span>
                                ))}
                            </div>
                        </div>
                        <motion.div
                            key={command.value}
                            className="home-agent-result"
                            initial={{ opacity: reduced ? 1 : 0.6, y: reduced ? 0 : 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: reduced ? 0 : 0.25 }}>
                            <div className="home-agent-result-title">
                                <PostbotLogo />
                                <span>Weekend on the coast</span>
                            </div>
                            <span className="home-agent-result-state">
                                {command.value === 'prepare'
                                    ? 'Draft created'
                                    : command.value === 'inspect'
                                      ? 'Revision 1 · draft'
                                      : 'Revision 1 · scheduled'}
                            </span>
                            <p>Less traffic. More coastline. Our new weekend route is ready.</p>
                            <div className="home-agent-destinations">
                                <span>X</span>
                                <span>LinkedIn</span>
                            </div>
                            <small>
                                {command.value === 'prepare'
                                    ? 'Nothing has been published.'
                                    : command.value === 'inspect'
                                      ? 'Content and execution state are read together.'
                                      : 'An explicit action, not a side effect of drafting.'}
                            </small>
                        </motion.div>
                    </div>
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
                <Scene className="home-social-spread">
                    <div className="home-source-note">
                        <span>Example source</span>
                        <h3>
                            A new route.
                            <br />
                            Two different conversations.
                        </h3>
                        <p>
                            Northline is introducing a weekend ride. Keep the announcement short on
                            X. Give the story more room on LinkedIn.
                        </p>
                    </div>
                    <article className="home-social-post home-social-x">
                        <div className="home-social-meta">
                            <svg
                                viewBox={`0 0 ${x.width} ${x.height}`}
                                width="22"
                                height="22"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: x.body }}
                            />
                            <span>
                                Northline <small>Example · X</small>
                            </span>
                        </div>
                        <p>
                            Less traffic. More coastline. Our new 32 km weekend route is ready.
                            Bring a friend — we roll out Saturday at 9.
                        </p>
                        <img
                            src="/product/coastal-route.svg"
                            alt="Illustrative coastal cycling route, with start and finish marked"
                            width="720"
                            height="540"
                            loading="lazy"
                        />
                        <span className="home-social-count">A short announcement</span>
                    </article>
                    <article className="home-social-post home-social-linkedin">
                        <div className="home-social-meta">
                            <svg
                                viewBox={`0 0 ${linkedin.width} ${linkedin.height}`}
                                width="26"
                                height="26"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: linkedin.body }}
                            />
                            <span>
                                Northline <small>Example · LinkedIn</small>
                            </span>
                        </div>
                        <p>Good routes make it easier to get outside together.</p>
                        <p>
                            We have been exploring a quieter stretch of coastline for our next
                            community ride. The result: a 32 km loop, a coffee stop, and enough time
                            to enjoy both.
                        </p>
                        <p>Join us on Saturday. New riders are welcome.</p>
                        <img
                            src="/product/ride-guide.svg"
                            alt="Example ride guide showing distance, meeting time and route elevation"
                            width="720"
                            height="400"
                            loading="lazy"
                        />
                        <span className="home-social-count">More context for the same story</span>
                    </article>
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
                            Adapt wording, media and dates independently. A short post on X does not
                            have to be a copy of your LinkedIn update.
                        </p>
                    </div>
                </div>
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
                <Scene className="home-storage-scene">
                    <div className="home-storage-title">
                        <PostbotLogo />
                        <span>Your workspace</span>
                        <small>Self-hosted</small>
                    </div>
                    <div className="home-storage-files">
                        <div>
                            <span>posts</span>
                            <strong>Source &amp; adaptations</strong>
                            <small>Shared content, destination drafts and revisions</small>
                        </div>
                        <div>
                            <span>media</span>
                            <strong>Originals &amp; previews</strong>
                            <small>Local storage or your S3-compatible bucket</small>
                        </div>
                        <div>
                            <span>access</span>
                            <strong>People &amp; agents</strong>
                            <small>Project roles and scoped API keys</small>
                        </div>
                    </div>
                    <div className="home-storage-bottom">
                        <span>One server. Several ways to work.</span>
                        <Link href="/docs/operations/">Read the operations guide</Link>
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
