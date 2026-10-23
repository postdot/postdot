import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { Accordion as FAQItem, Accordions as FAQ } from 'fumadocs-ui/components/accordion'

import { PublicCapabilities } from './public-capabilities'
import { PublicEntrance } from './public-entrance'
import { Link } from './site-link'
import { UsageGallery } from './usage-study'

const questions = [
    {
        title: 'Do I need an AI agent?',
        answer: 'No. You can write, adapt and manage publications entirely in the web app. The CLI and REST API give your existing agents and scripts another way to work with the same posts.',
    },
    {
        title: 'Does Postdot generate content?',
        answer: 'Postdot does not contain a built-in AI writer. Your own agent can prepare content and create drafts through the CLI or API. You choose its access and what it is allowed to do.',
    },
    {
        title: 'Which destinations can I connect?',
        answer: 'Bluesky, Discord, LinkedIn, Mastodon, X and DEV.to, plus manual and custom HTTP destinations. Available content types and connection requirements vary by provider.',
    },
    {
        title: 'Where does Postdot run?',
        answer: 'On infrastructure you manage. The installation guide uses Docker Compose from a source checkout, with local media storage by default and optional S3-compatible storage.',
    },
    {
        title: 'Can I use my existing AI tools?',
        answer: 'Yes, if they can run CLI commands or call a REST API. Give the integration a scoped API key. Postdot does not require a particular model or AI subscription. A dedicated MCP server is not available yet.',
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
        answer: 'Yes. Postdot supports S3-compatible media storage as well as local storage. Display previews are separate from the original files used for publishing.',
    },
    {
        title: 'Who handles backups?',
        answer: 'You operate and back up your installation. The operations guide covers the database, media and configuration needed to restore a workspace. Postdot does not replace your infrastructure backup system.',
    },
]

export function PublicStory() {
    return (
        <div className="home-product-story">
            <UsageGallery embedded />
            <PublicCapabilities />
            <section
                id="questions"
                className="home-chapter home-questions"
                aria-labelledby="questions-title">
                <PublicEntrance kind="copy" className="home-questions-intro">
                    <h2 id="questions-title">About running Postdot.</h2>
                    <nav className="home-questions-guides" aria-label="Get started with Postdot">
                        <Link href="/docs/installation/">
                            Installation guide
                            <ArrowRightIcon size={17} aria-hidden="true" />
                        </Link>
                        <Link href="/docs/automation/">
                            API & automation
                            <ArrowRightIcon size={17} aria-hidden="true" />
                        </Link>
                    </nav>
                </PublicEntrance>
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
