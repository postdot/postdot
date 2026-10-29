// cspell:ignore مرحبًا

import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { PaperclipIcon } from '@solar-icons/react/linear/paperclip'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { motion, useReducedMotion } from 'motion/react'

import { ChannelsScene, MediaScene, ProjectsScene } from './capability-scenes'
import { PublicEntrance } from './public-entrance'

import './public-capabilities.css'

export function PublicCapabilities() {
    const reduced = useReducedMotion()
    return (
        <section className="home-capabilities" aria-labelledby="capabilities-title">
            <PublicEntrance kind="copy" className="capabilities-heading">
                <h2 id="capabilities-title">Room for every project.</h2>
                <p>Your content, media and collaborators, with a place for each.</p>
            </PublicEntrance>
            <div className="capabilities-grid">
                <article className="capability-projects">
                    <div className="capability-copy">
                        <h3>
                            Separate projects.
                            <br />
                            Bring people together.
                        </h3>
                        <p>
                            A workspace groups your people and projects. Each project keeps its own
                            posts, channels and media, with access you control.
                        </p>
                    </div>
                    <ProjectsScene />
                </article>
                <article className="capability-media">
                    <div className="capability-copy">
                        <h3>
                            Your media.
                            <br />
                            Ready for the next post.
                        </h3>
                        <p>
                            Keep images and videos in your library. Use local storage or connect
                            your S3-compatible bucket.
                        </p>
                    </div>
                    <MediaScene />
                </article>
                <article className="capability-detail capability-channels">
                    <h3>
                        Built-in channels.
                        <br />
                        Custom options, too.
                    </h3>
                    <ChannelsScene />
                    <p className="capability-small-caption">Connected, manual or custom.</p>
                </article>
                <motion.article
                    className="capability-detail capability-expression"
                    initial="rest"
                    whileInView="open"
                    whileHover={reduced ? undefined : 'active'}
                    viewport={{ once: true, amount: 0.5 }}>
                    <h3>Make it yours.</h3>
                    <div className="capability-typesetting" aria-hidden="true">
                        <strong>Your words,</strong>
                        <em>
                            your way.
                            <motion.span
                                className="capability-word-underline"
                                variants={{
                                    rest: { scaleX: reduced ? 1 : 0 },
                                    open: { scaleX: 1 },
                                    active: { scaleX: [0, 1] },
                                }}
                                transition={{
                                    duration: reduced ? 0 : 0.65,
                                    ease: [0.16, 1, 0.3, 1],
                                }}
                            />
                        </em>
                        <div className="capability-writing-tools">
                            <SmileCircleIcon size={26} />
                            <PaperclipIcon size={25} />
                            <GalleryIcon size={25} />
                        </div>
                    </div>
                    <p className="capability-small-caption">
                        Text, emoji & media. Tools adapt to the network.
                    </p>
                </motion.article>
                <article className="capability-detail capability-languages">
                    <div
                        className="capability-greetings"
                        aria-label="Hello, Bonjour, and an Arabic greeting">
                        <span lang="en">Hello.</span>
                        <span lang="fr">Bonjour.</span>
                        <span lang="ar" dir="rtl">
                            مرحبًا.
                        </span>
                    </div>
                    <div
                        className="capability-flag-ribbon"
                        aria-label="English and French are available. Other flags illustrate future language expansion.">
                        {[
                            ['gb', 'English', true],
                            ['fr', 'French', true],
                            ['jp', 'Japanese', false],
                            ['cn', 'Chinese', false],
                            ['ae', 'Arabic', false],
                            ['es', 'Spanish', false],
                            ['de', 'German', false],
                            ['it', 'Italian', false],
                        ].map(([code, name, current]) => (
                            <img
                                key={String(code)}
                                src={`/flags/${code}.svg`}
                                alt={String(name)}
                                width="28"
                                height="21"
                                loading="lazy"
                                data-future={!current || undefined}
                                title={`${name}${current ? ' — available' : ' — future language example'}`}
                            />
                        ))}
                    </div>
                    <h3 className="sr-only">A multilingual interface</h3>
                    <p className="capability-small-caption">
                        EN & FR today. More languages to come.
                    </p>
                </article>
            </div>
        </section>
    )
}
