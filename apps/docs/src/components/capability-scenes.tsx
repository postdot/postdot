// cspell:words playhead
import { CloudIcon } from '@solar-icons/react/linear/cloud'
import { CodeSquareIcon } from '@solar-icons/react/linear/code-square'
import { GalleryIcon } from '@solar-icons/react/linear/gallery'
import { PlayIcon } from '@solar-icons/react/linear/play'
import { UsersGroupRoundedIcon } from '@solar-icons/react/linear/users-group-rounded'
import { motion, useReducedMotion } from 'motion/react'
import Bluesky from '~icons/logos/bluesky'
import LinkedIn from '~icons/logos/linkedin-icon'

import './capability-scenes.css'

const projects = [
    { name: 'Your brand', members: ['A', 'M'] },
    { name: 'Client work', members: ['A', 'M', 'K'] },
    { name: 'Side project', members: ['K'] },
]
const transition = { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const }

export function ProjectsScene() {
    const reduced = useReducedMotion()
    return (
        <motion.div
            className="capability-workspace capability-scene capability-scene-projects"
            initial="rest"
            whileInView="open"
            whileHover="active"
            viewport={{ once: true, amount: 0.5 }}
            role="img"
            aria-label="A workspace with three separate project folders. Posts, channels and media unfold as separate sheets, with illustrative members on each folder.">
            <div className="capability-workspace-label" aria-hidden="true">
                <UsersGroupRoundedIcon size={18} />
                <span>Your workspace</span>
                <span className="capability-people">
                    <span className="capability-avatars">
                        {['A', 'M', 'K'].map(name => (
                            <i key={name}>{name}</i>
                        ))}
                    </span>
                    <span className="capability-people-caption">People &amp; permissions</span>
                </span>
            </div>
            <div className="capability-folders" aria-hidden="true">
                {projects.map((project, index) => (
                    <motion.div
                        key={project.name}
                        className={`capability-folder capability-folder-${index}`}
                        variants={{
                            rest: { rotate: 0, x: 0 },
                            open: {
                                rotate: reduced ? 0 : (index - 1) * 5,
                                x: reduced ? 0 : (index - 1) * 8,
                            },
                            active: {
                                rotate: reduced ? 0 : (index - 1) * 7,
                                x: reduced ? 0 : (index - 1) * 12,
                            },
                        }}
                        transition={transition}>
                        {['Posts', 'Channels', 'Media'].map((kind, sheet) => (
                            <motion.div
                                key={kind}
                                className={`project-content-sheet project-content-sheet-${sheet}`}
                                variants={{
                                    rest: { y: reduced ? sheet * 24 : 40 },
                                    open: { y: sheet * 24 },
                                    active: { y: sheet * 24 - (reduced ? 0 : 8 - sheet * 2) },
                                }}
                                transition={{ ...transition, delay: index * 0.06 + sheet * 0.05 }}>
                                <span className="project-sheet-heading">
                                    <span>{kind}</span>
                                    {sheet === 0 ? (
                                        <span className="project-sheet-writing">
                                            <i />
                                            <i />
                                        </span>
                                    ) : sheet === 1 ? (
                                        <span className="project-sheet-channels">
                                            <LinkedIn />
                                            <Bluesky />
                                        </span>
                                    ) : (
                                        <GalleryIcon size={13} strokeWidth={1.25} />
                                    )}
                                </span>
                            </motion.div>
                        ))}
                        <div className="capability-folder-cover">
                            <span>{project.name}</span>
                            <span className="capability-avatars capability-avatars-small">
                                {project.members.map(name => (
                                    <i key={name}>{name}</i>
                                ))}
                            </span>
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.div>
    )
}

export function MediaScene() {
    const reduced = useReducedMotion()
    return (
        <motion.div
            className="capability-file-scene capability-scene capability-scene-media"
            initial="rest"
            whileInView="open"
            whileHover="active"
            viewport={{ once: true, amount: 0.5 }}
            role="img"
            aria-label="Image and video files in a shared media library. A crop frame produces a separate smaller preview; originals use local or S3-compatible storage.">
            <div className="capability-media-stack" aria-hidden="true">
                <motion.div
                    className="capability-media-video"
                    variants={{
                        rest: { rotate: reduced ? 10 : 0, x: reduced ? 28 : 0 },
                        open: { rotate: 10, x: 28 },
                        active: { rotate: reduced ? 10 : 14, x: reduced ? 28 : 36 },
                    }}
                    transition={transition}>
                    <span className="capability-media-type">VIDEO</span>
                    <div className="capability-video-preview">
                        <PlayIcon size={40} strokeWidth={1} />
                    </div>
                    <div className="capability-video-frames">
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <motion.span
                            className="media-video-playhead"
                            variants={{
                                rest: { x: 0 },
                                open: { x: reduced ? 0 : 76 },
                                active: { x: reduced ? 0 : 36 },
                            }}
                            transition={{ ...transition, duration: 1.6, delay: 0.2 }}
                        />
                    </div>
                </motion.div>
                <motion.div
                    className="capability-media-image"
                    variants={{
                        rest: { rotate: reduced ? -7 : 0, x: reduced ? -28 : 0 },
                        open: { rotate: -7, x: -28 },
                        active: { rotate: reduced ? -7 : -10, x: reduced ? -28 : -36 },
                    }}
                    transition={transition}>
                    <span className="capability-media-type">IMAGE</span>
                    <div className="capability-media-frame">
                        <GalleryIcon size={68} strokeWidth={1} />
                        <motion.span
                            className="media-crop-frame"
                            variants={{
                                rest: { scale: 1 },
                                open: { scale: reduced ? 1 : 0.82 },
                                active: { scale: reduced ? 1 : 0.92 },
                            }}
                            transition={{ ...transition, delay: 0.25 }}>
                            <i />
                            <i />
                            <i />
                            <i />
                        </motion.span>
                    </div>
                    <span className="capability-media-caption">Original</span>
                </motion.div>
                <motion.div
                    className="capability-media-preview"
                    variants={{
                        rest: {
                            x: reduced ? 0 : -60,
                            y: reduced ? 0 : -54,
                            scale: reduced ? 1 : 0.72,
                            opacity: reduced ? 1 : 0,
                        },
                        open: { x: 0, y: 0, scale: 1, opacity: 1, rotate: reduced ? 0 : 3 },
                        active: { x: 0, y: reduced ? 0 : -6, scale: 1, opacity: 1, rotate: 0 },
                    }}
                    transition={{ ...transition, delay: 0.4 }}>
                    <GalleryIcon size={26} strokeWidth={1} />
                    <span>Preview</span>
                </motion.div>
            </div>
            <span className="capability-storage" aria-hidden="true">
                <CloudIcon size={16} />
                Local or S3-compatible
            </span>
        </motion.div>
    )
}

const channelModules = [
    { name: 'LinkedIn', mark: <LinkedIn />, kind: 'native' },
    { name: 'Bluesky', mark: <Bluesky />, kind: 'native' },
    { name: 'Custom', mark: <CodeSquareIcon size={34} strokeWidth={1.25} />, kind: 'custom' },
]

export function ChannelsScene() {
    const reduced = useReducedMotion()
    return (
        <motion.div
            className="capability-channel-pair capability-scene capability-scene-channels"
            initial="rest"
            whileInView="open"
            whileHover="active"
            viewport={{ once: true, amount: 0.5 }}
            role="img"
            aria-label="LinkedIn, Bluesky and a custom HTTP module fit side by side in the same channel system.">
            <div className="channel-module-rack" aria-hidden="true">
                <div className="channel-module-support">
                    <i />
                    <i />
                    <i />
                </div>
                {channelModules.map((channel, index) => (
                    <motion.div
                        key={channel.name}
                        className={`channel-module channel-module-${channel.kind}`}
                        variants={{
                            rest: { y: reduced ? 0 : -24, rotate: reduced ? 0 : (index - 1) * 4 },
                            open: { y: 0, rotate: 0 },
                            active: {
                                y: reduced ? 0 : index === 2 ? -12 : -3,
                                rotate: reduced ? 0 : index === 2 ? 4 : 0,
                            },
                        }}
                        transition={{ ...transition, delay: index * 0.12 }}>
                        <div className="channel-module-face">{channel.mark}</div>
                        <span className="channel-module-foot">
                            <i />
                            <i />
                            <i />
                        </span>
                    </motion.div>
                ))}
                <span className="channel-module-label channel-module-label-native">Built-in</span>
                <span className="channel-module-label channel-module-label-custom">Custom</span>
            </div>
        </motion.div>
    )
}
