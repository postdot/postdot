'use client'

// cspell:ignore مرحبًا

import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import x from '@iconify-icons/logos/x'
import { CloudIcon } from '@solar-icons/react/linear/cloud'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { PaperclipIcon } from '@solar-icons/react/linear/paperclip'
import { PlayIcon } from '@solar-icons/react/linear/play'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { UsersGroupRoundedIcon } from '@solar-icons/react/linear/users-group-rounded'
import { motion, useReducedMotion } from 'motion/react'

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
                <motion.article
                    className="capability-projects"
                    initial="rest"
                    whileInView="open"
                    whileHover={reduced ? 'rest' : 'hovered'}
                    viewport={{ once: true, amount: 0.4 }}>
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
                    <div
                        className="capability-workspace"
                        role="img"
                        aria-label="One workspace groups three separate projects: Your brand, Client work and Side project.">
                        <div className="capability-workspace-label">
                            <UsersGroupRoundedIcon size={18} />
                            <span>Your workspace</span>
                            <span>People & permissions</span>
                        </div>
                        <div className="capability-folders" aria-hidden="true">
                            {['Your brand', 'Client work', 'Side project'].map((name, index) => (
                                <motion.div
                                    key={name}
                                    className={`capability-folder capability-folder-${index}`}
                                    variants={{
                                        rest: { x: 0, rotate: 0 },
                                        open: {
                                            x: reduced ? 0 : (index - 1) * 14,
                                            rotate: reduced ? 0 : (index - 1) * 5,
                                        },
                                        hovered: { x: (index - 1) * 23, rotate: (index - 1) * 8 },
                                    }}
                                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}>
                                    <div className="capability-folder-paper">
                                        <span>Posts</span>
                                        <span>Channels</span>
                                        <span>Media</span>
                                    </div>
                                    <div className="capability-folder-cover">
                                        <span>{name}</span>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </motion.article>
                <motion.article
                    className="capability-media"
                    initial="rest"
                    whileInView="open"
                    whileHover={reduced ? 'rest' : 'hovered'}
                    viewport={{ once: true, amount: 0.4 }}>
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
                    <div
                        className="capability-file-scene"
                        role="img"
                        aria-label="Images and videos share a media library, with previews kept separate from the originals.">
                        <motion.div
                            className="capability-file capability-video"
                            aria-hidden="true"
                            variants={{
                                rest: { rotate: 0, x: 0 },
                                open: { rotate: reduced ? 0 : 9, x: reduced ? 0 : 28 },
                                hovered: { rotate: 13, x: 38 },
                            }}
                            transition={{ duration: 0.65 }}>
                            <span>VIDEO</span>
                            <div className="capability-video-frame">
                                <PlayIcon size={35} />
                            </div>
                            <div className="capability-film-track">
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                            </div>
                        </motion.div>
                        <motion.div
                            className="capability-file capability-image"
                            aria-hidden="true"
                            variants={{
                                rest: { rotate: 0, x: 0 },
                                open: { rotate: reduced ? 0 : -7, x: reduced ? 0 : -24 },
                                hovered: { rotate: -11, x: -32 },
                            }}
                            transition={{ duration: 0.65 }}>
                            <span>IMAGE</span>
                            <div className="capability-image-frame">
                                <GalleryIcon size={62} strokeWidth={1} />
                            </div>
                            <span className="capability-file-caption">Original + previews</span>
                        </motion.div>
                        <span className="capability-storage">
                            <CloudIcon size={15} /> Local or S3-compatible
                        </span>
                    </div>
                </motion.article>
                <article className="capability-detail capability-channels">
                    <h3>Your networks, together.</h3>
                    <div
                        className="capability-brand-cloud"
                        role="img"
                        aria-label="Built-in channels include X, LinkedIn, Bluesky, Discord and Mastodon.">
                        {[
                            { name: 'X', icon: x },
                            { name: 'LinkedIn', icon: linkedin },
                            { name: 'Bluesky', icon: bluesky },
                            { name: 'Discord', icon: discord },
                            { name: 'Mastodon', icon: mastodon },
                        ].map((brand, index) => (
                            <motion.span
                                key={brand.name}
                                className={`capability-brand capability-brand-${index}`}
                                aria-hidden="true"
                                whileHover={reduced ? undefined : { rotate: 0, scale: 1.12 }}
                                transition={{ duration: 0.3 }}>
                                <svg
                                    viewBox={`0 0 ${brand.icon.width} ${brand.icon.height}`}
                                    dangerouslySetInnerHTML={{ __html: brand.icon.body }}
                                />
                            </motion.span>
                        ))}
                    </div>
                    <p className="capability-small-caption">
                        Built-in channels. Custom options, too.
                    </p>
                </article>
                <motion.article
                    className="capability-detail capability-expression"
                    initial="rest"
                    whileInView="open"
                    whileHover={reduced ? undefined : 'spread'}
                    viewport={{ once: true, amount: 0.5 }}>
                    <h3>Make it yours.</h3>
                    <div className="capability-expression-art" aria-hidden="true">
                        <motion.strong
                            className="capability-expression-bold"
                            variants={{
                                rest: { rotate: -8 },
                                open: { rotate: -5 },
                                spread: { rotate: -10, x: -7, y: 3 },
                            }}>
                            B
                        </motion.strong>
                        <motion.em
                            className="capability-expression-italic"
                            variants={{
                                rest: { rotate: 9 },
                                open: { rotate: 4 },
                                spread: { rotate: 12, x: 8, y: -5 },
                            }}>
                            Italic
                        </motion.em>
                        <motion.span
                            className="capability-expression-smile"
                            variants={{
                                rest: { rotate: -15 },
                                open: { rotate: 8 },
                                spread: { rotate: 20, x: 9, y: 5 },
                            }}>
                            <SmileCircleIcon size={64} strokeWidth={1.2} />
                        </motion.span>
                        <motion.span
                            className="capability-expression-clip"
                            variants={{
                                rest: { rotate: 30 },
                                open: { rotate: 15 },
                                spread: { rotate: 0, x: -8, y: -4 },
                            }}>
                            <PaperclipIcon size={48} strokeWidth={1.4} />
                        </motion.span>
                        <motion.span
                            className="capability-expression-image"
                            variants={{
                                rest: { rotate: 8 },
                                open: { rotate: -9 },
                                spread: { rotate: -17, x: -4, y: 8 },
                            }}>
                            <GalleryIcon size={43} strokeWidth={1.2} />
                        </motion.span>
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
