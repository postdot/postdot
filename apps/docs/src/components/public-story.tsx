import { ArrowRightIcon } from '@solar-icons/react/linear/arrow-right'
import { Accordion as FAQItem, Accordions as FAQ } from 'fumadocs-ui/components/accordion'

import { PublicCapabilities } from './public-capabilities'
import { PublicEntrance } from './public-entrance'
import { Link } from './site-link'
import { UsageGallery } from './usage-study'

const questions = [
    {
        title: 'Which destinations can I connect?',
        answer: 'Bluesky, Discord, LinkedIn, Mastodon, X, Telegram and DEV.to, plus manual and custom HTTP destinations. Check the connection guides for supported content and account requirements.',
    },
    {
        title: 'Do I need developer accounts for the networks?',
        answer: 'Some platforms require your own developer application or API credentials. Their access rules and charges apply to your installation. The connection guides explain the setup for each network.',
    },
    {
        title: 'Can each network have different content?',
        answer: 'Yes. Each destination has its own text, media and schedule. You can adapt a publication without changing the source or an earlier published version.',
    },
    {
        title: 'Can I use Postdot without an agent?',
        answer: 'Yes. Write, adapt, review and schedule in Studio. If you use an agent, connect it through MCP, the CLI or the API with a scoped API key. Postdot has no built-in AI writer.',
    },
    {
        title: 'Does an agent-created draft publish automatically?',
        answer: 'An unscheduled draft stays in your queue for review. Scheduling and delivery require separate actions and permissions. A draft-only API key lets an agent prepare content without permission to publish it.',
    },
    {
        title: 'Can I change databases or media storage later?',
        answer: 'Yes. The image includes tools to transfer an installation between SQLite and PostgreSQL, and media between local and S3-compatible storage. Stop the servers and follow the transfer guide; changing a setting alone does not move existing data.',
    },
    {
        title: 'How do I update and back up my installation?',
        answer: 'Read the release notes before updating. Back up your database, media and deployment secrets. The installation and operations guides cover the steps for each storage setup.',
    },
]

export function PublicStory() {
    return (
        <div className="home-product-story">
            <UsageGallery embedded />
            <PublicCapabilities />
            <section className="home-chapter home-hosting" aria-labelledby="hosting-title">
                <PublicEntrance kind="copy">
                    <h2 id="hosting-title">Choose how you host it.</h2>
                    <p>
                        Run SQLite or PostgreSQL with the same Docker image. Store media locally or
                        in an S3-compatible bucket. Move between them as your setup changes.
                    </p>
                </PublicEntrance>
                <div className="home-hosting-options">
                    <div>
                        <h3>One service to get started</h3>
                        <p>
                            Studio, the API, scheduler and publication worker run together. SQLite
                            and local media need no separate database or queue service.
                        </p>
                        <Link href="/docs/installation/">Install with Docker Compose</Link>
                    </div>
                    <div>
                        <h3>Use your existing infrastructure</h3>
                        <p>
                            Connect PostgreSQL and S3, or run coordinated Postdot instances with
                            both. The same image includes the tools to transfer your data.
                        </p>
                        <Link href="/docs/postgresql/">PostgreSQL deployment</Link>
                    </div>
                </div>
            </section>
            <section
                id="questions"
                className="home-chapter home-questions"
                aria-labelledby="questions-title">
                <PublicEntrance kind="copy" className="home-questions-intro">
                    <h2 id="questions-title">Before you get started.</h2>
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
