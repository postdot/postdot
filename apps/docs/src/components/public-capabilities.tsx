'use client'

import { CloudIcon } from '@solar-icons/react/linear/cloud'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { PlayIcon } from '@solar-icons/react/linear/play'
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
                    <div className="capability-destinations" aria-hidden="true">
                        <span>Connected</span>
                        <span>Manual</span>
                        <span>Custom HTTP</span>
                    </div>
                    <h3>Work beyond the built-in networks.</h3>
                    <p>Track manual publications or connect your own HTTP destination.</p>
                </article>
                <article className="capability-detail capability-languages">
                    <div className="capability-language-pair" aria-hidden="true">
                        <span>Hello.</span>
                        <span>Bonjour.</span>
                    </div>
                    <h3>English or French. Your choice.</h3>
                    <p>Change the interface language. Your posts keep their own voice.</p>
                </article>
            </div>
        </section>
    )
}
