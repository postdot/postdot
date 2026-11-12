import { alternatives } from '@/lib/alternatives'

import { EditorialShell } from './editorial-page'
import { Link } from './site-link'

import './comparison.css'

export function AlternativesIndex() {
    return (
        <EditorialShell>
            <div className="alternatives-index">
                <header className="alternatives-heading">
                    <h1>Social media publishing alternatives</h1>
                    <p>
                        Compare Postdot with Postiz, Mixpost and PostFast on the work you do:
                        planning publications, sharing destinations, managing people and connecting
                        your tools.
                    </p>
                </header>
                <div className="alternatives-catalog">
                    {alternatives.map(item => (
                        <article key={item.slug}>
                            <div className="alternative-name">
                                <h2>
                                    <Link href={`/alternatives/${item.slug}`}>
                                        Postdot vs {item.name}
                                    </Link>
                                </h2>
                            </div>
                            <div>
                                <h3>{item.angle}</h3>
                                <p>{item.summary}</p>
                                <Link
                                    className="editorial-read"
                                    href={`/alternatives/${item.slug}`}>
                                    Compare Postdot and {item.name}
                                </Link>
                            </div>
                        </article>
                    ))}
                </div>
                <section className="alternatives-method" aria-labelledby="comparison-approach">
                    <h2 id="comparison-approach">The same questions, different decisions</h2>
                    <p>
                        Every comparison covers projects and teams, shared and manual channels,
                        platform support, languages, automation, ownership and operation. The
                        analysis then looks at what those differences change for your work.
                    </p>
                    <p>
                        Postdot brings workspaces, projects and reusable channels into one
                        publishing plan. Collaborators can work in English, French, Spanish or
                        German, prepare drafts with agents or n8n, and finish manual publications
                        alongside automated ones.
                    </p>
                    <p>
                        Read the{' '}
                        <Link href="/docs/first-publication/">first-publication guide</Link> to try
                        the workflow, or{' '}
                        <Link href="/features">explore publishing with Postdot</Link>.
                    </p>
                </section>
            </div>
        </EditorialShell>
    )
}
