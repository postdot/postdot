'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import type { ReactNode } from 'react'

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
    const reducedMotion = useReducedMotion()
    return (
        <motion.div
            className={className}
            initial={false}
            whileInView={{ y: 0, opacity: 1 }}
            style={{ y: reducedMotion ? 0 : 24 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: reducedMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}>
            {children}
        </motion.div>
    )
}

export function PublicStory() {
    return (
        <>
            <section id="workflow" className="home-story home-story-draft">
                <div className="home-story-copy">
                    <h2>
                        Your agent prepares.
                        <br />
                        You take it from there.
                    </h2>
                    <p>
                        Give your agent access through the CLI or API. It can create a draft in the
                        same workspace you use to review and publish.
                    </p>
                    <Link href="/docs/automation/">Work with agents</Link>
                </div>
                <Reveal className="home-draft-scene">
                    <div className="home-story-command">
                        <span>CLI</span>
                        <code>
                            bun run postbot posts create --project "$PROJECT_ID" --input post.json
                        </code>
                    </div>
                    <article className="home-story-paper">
                        <div className="home-paper-top">
                            <span>Example draft</span>
                            <span>Not published</span>
                        </div>
                        <h3>A new collection, ready for Friday.</h3>
                        <p>
                            Made in small batches.
                            <br />
                            Designed for everyday use.
                        </p>
                        <div className="home-paper-bottom">
                            <span>Source post</span>
                            <span>Ready to review</span>
                        </div>
                    </article>
                </Reveal>
            </section>
            <section className="home-story-adapt">
                <div className="home-story-heading">
                    <h2>
                        The idea stays.
                        <br />
                        The post can change.
                    </h2>
                    <p>
                        Give each destination its own wording, media and date. Updating the source
                        leaves your adaptations intact.
                    </p>
                </div>
                <div className="home-adaptation-scene">
                    <Reveal className="home-adaptation-long">
                        <div className="home-adaptation-label">
                            Newsletter <span>Example adaptation</span>
                        </div>
                        <h3>Meet the spring collection.</h3>
                        <div className="home-editorial-art" aria-hidden="true">
                            <span>spring</span>
                            <span>collection</span>
                        </div>
                        <p>
                            Small batches. Everyday pieces.
                            <br />
                            Take a closer look this Friday.
                        </p>
                    </Reveal>
                    <Reveal className="home-adaptation-short">
                        <div className="home-adaptation-label">
                            Community <span>Example adaptation</span>
                        </div>
                        <h3>Friday. Something new.</h3>
                        <p>
                            The spring collection is nearly here.
                            <br />
                            Which piece are you waiting for?
                        </p>
                        <div className="home-community-art" aria-hidden="true">
                            <span>
                                See you
                                <br />
                                Friday.
                            </span>
                        </div>
                    </Reveal>
                </div>
            </section>
            <section className="home-story home-story-schedule">
                <div className="home-story-copy">
                    <h2>
                        Make room for
                        <br />
                        what comes next.
                    </h2>
                    <p>
                        Choose when each destination goes live. See what is scheduled, what was
                        published and what needs your attention.
                    </p>
                    <Link href="/docs/first-publication/">Plan a publication</Link>
                </div>
                <Reveal className="home-week-scene">
                    <div className="home-week-top">
                        <span>Example week</span>
                        <span>October</span>
                    </div>
                    <div
                        className="home-week-scroll"
                        role="region"
                        aria-label="Example publication calendar"
                        tabIndex={0}
                        data-lenis-prevent>
                        <div className="home-week-grid">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, index) => (
                                <div key={day} className="home-week-day">
                                    <span>{day}</span>
                                    <strong>{12 + index}</strong>
                                    {index === 1 && (
                                        <div className="home-week-post">
                                            <span>Newsletter</span>
                                            <strong>Spring collection</strong>
                                            <small>Published</small>
                                        </div>
                                    )}
                                    {index === 4 && (
                                        <div className="home-week-post home-week-post-next">
                                            <span>Community</span>
                                            <strong>Friday launch</strong>
                                            <small>Scheduled · 09:00</small>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </Reveal>
            </section>
            <section className="home-open-source">
                <Reveal>
                    <h2>
                        Your workspace.
                        <br />
                        On your server.
                    </h2>
                    <p>
                        Postbot is open source and self-hosted. Keep your posts, media and
                        connections on infrastructure you manage.
                    </p>
                    <Link href="/docs/installation/">Install Postbot</Link>
                </Reveal>
            </section>
        </>
    )
}
