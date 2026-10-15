'use client'

// cspell:ignore Français

import { ClipboardCheckIcon } from '@solar-icons/react/linear/clipboard-check'
import { CloudIcon } from '@solar-icons/react/linear/cloud'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { LinkIcon } from '@solar-icons/react/linear/link'
import { PaperclipIcon } from '@solar-icons/react/linear/paperclip'
import { PlayIcon } from '@solar-icons/react/linear/play'
import { SmileCircleIcon } from '@solar-icons/react/linear/smile-circle'
import { TextBoldIcon } from '@solar-icons/react/linear/text-bold'
import { TextItalicIcon } from '@solar-icons/react/linear/text-italic'
import { UsersGroupRoundedIcon } from '@solar-icons/react/linear/users-group-rounded'
import { motion, useReducedMotion } from 'motion/react'

import { PostbotLogo } from './brand'
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
                    <h3>Your destination isn’t listed?</h3>
                    <p>Add a manual channel, or connect your own service through HTTP.</p>
                    <div
                        className="capability-channel-paths"
                        role="img"
                        aria-label="Postbot supports manual publishing tasks and custom HTTP delivery to your own service.">
                        <PostbotLogo aria-hidden="true" />
                        <svg viewBox="0 0 50 100" aria-hidden="true">
                            <path d="M0 50H16Q24 50 24 42V24Q24 16 32 16H50M16 50Q24 50 24 58V76Q24 84 32 84H50" />
                        </svg>
                        <div aria-hidden="true">
                            <span>
                                <ClipboardCheckIcon size={19} />
                                Publish manually
                            </span>
                            <span>
                                <LinkIcon size={19} />
                                Send to your service
                            </span>
                        </div>
                    </div>
                </article>
                <article className="capability-detail capability-languages">
                    <h3>At home in your language.</h3>
                    <div className="capability-language-options">
                        <span>
                            <img src="/flags/gb.svg" width="24" height="18" alt="" />
                            English
                        </span>
                        <span>
                            <img src="/flags/fr.svg" width="24" height="18" alt="" />
                            Français
                        </span>
                    </div>
                    <p>English and French today. More languages planned.</p>
                    <span className="capability-language-note">
                        Interface language, independent of your posts.
                    </span>
                </article>
                <motion.article
                    className="capability-editor"
                    initial="rest"
                    whileInView="focus"
                    whileHover={reduced ? undefined : 'focus'}
                    viewport={{ once: true, amount: 0.5 }}>
                    <div className="capability-editor-copy">
                        <h3>
                            Give your words
                            <br />
                            the right tools.
                        </h3>
                        <p>
                            Format your text, add emoji and media, and check the preview as you
                            write. Available formatting follows the destination.
                        </p>
                        <ul>
                            <li>Rich text where supported</li>
                            <li>Emoji, links and attachments</li>
                            <li>Destination previews</li>
                        </ul>
                    </div>
                    <div
                        className="capability-editor-example"
                        role="img"
                        aria-label="Illustrative editor excerpt: a bold opening line, a short invitation and a link. Formatting availability depends on the destination.">
                        <div className="capability-editor-toolbar" aria-hidden="true">
                            <TextBoldIcon size={19} />
                            <TextItalicIcon size={19} />
                            <LinkIcon size={19} />
                            <span />
                            <SmileCircleIcon size={19} />
                            <PaperclipIcon size={19} />
                        </div>
                        <div className="capability-editor-paper" aria-hidden="true">
                            <motion.strong
                                variants={{
                                    rest: { backgroundColor: 'rgba(36,87,214,0)' },
                                    focus: {
                                        backgroundColor: reduced
                                            ? 'rgba(36,87,214,.12)'
                                            : [
                                                  'rgba(36,87,214,0)',
                                                  'rgba(36,87,214,.16)',
                                                  'rgba(36,87,214,.08)',
                                              ],
                                    },
                                }}
                                transition={{ duration: 1.2 }}>
                                Doors open Saturday.
                            </motion.strong>
                            <p>
                                Come say hello, meet the team,
                                <br />
                                and see what we’re making.
                            </p>
                            <span className="capability-editor-link">See you at the studio</span>
                        </div>
                        <span className="capability-editor-example-label">
                            Illustrative editor excerpt
                        </span>
                    </div>
                </motion.article>
            </div>
        </section>
    )
}
