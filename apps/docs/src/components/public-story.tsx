'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@postbot/ui/components/tabs'
import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { Accordion as FAQItem, Accordions as FAQ } from 'fumadocs-ui/components/accordion'
import Link from 'next/link'
import { type ReactNode } from 'react'

import { PostbotLogo } from './brand'
import { PublicEntrance } from './public-entrance'
import { PublicScreenshot } from './public-screenshot'
import { UsageGallery } from './usage-study'

function Scene({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <PublicEntrance className={`home-scene ${className}`}>{children}</PublicEntrance>
}

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

export function PublicStory() {
    return (
        <div className="home-product-story">
            <section id="planning" className="home-chapter home-planning-chapter">
                <PublicEntrance kind="copy" className="home-chapter-heading home-heading-split">
                    <h2>
                        See what is going out.
                        <br />
                        And what still needs you.
                    </h2>
                    <p>
                        Plan across destinations, then follow each publication. Your calendar and
                        queue show timing and state from the same workspace.
                    </p>
                </PublicEntrance>
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
            <UsageGallery embedded />
            <section id="self-hosting" className="home-chapter home-ownership-chapter">
                <PublicEntrance kind="copy" className="home-ownership-copy">
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
                </PublicEntrance>
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
