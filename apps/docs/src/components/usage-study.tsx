import { RestartIcon } from '@solar-icons/react/linear/restart'
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef, useState } from 'react'
import Mcp from '~icons/logos/model-context-protocol-icon'

import { PostdotLogo } from './brand'
import { ProductImage } from './product-image'

import './public-home.css'
import './usage-study.css'
import { WorkflowIllustration } from './workflow-illustration'

export function UsageGallery({ embedded = false }: { embedded?: boolean }) {
    const [terminalRun, setTerminalRun] = useState(0)
    const terminal = useRef<HTMLDivElement>(null)
    const terminalVisible = useInView(terminal, { once: true, amount: 0.5 })
    const stage = useRef<HTMLDivElement>(null)
    const reduced = useReducedMotion()
    const { scrollYProgress } = useScroll({ target: stage, offset: ['start end', 'end start'] })
    const protocolRotate = useTransform(scrollYProgress, [0, 1], [-12, 12])
    return (
        <section
            id={embedded ? 'automation' : undefined}
            className={`usage-section ${embedded ? 'usage-embedded' : ''}`}
            aria-labelledby="usage-title">
            <div className="usage-heading">
                <h2 id="usage-title">
                    Your tools.
                    <br />
                    Your way to publish.
                </h2>
                <p>Open the Studio. Bring your agent. Connect your workflows.</p>
            </div>
            <div className="usage-gallery" ref={stage}>
                <article className="usage-studio">
                    <div className="usage-caption">
                        <span className="usage-status" data-status="available">
                            Available
                        </span>
                        <h3>Studio</h3>
                        <p>A place to make it yours.</p>
                    </div>
                    <motion.div
                        className="usage-browser"
                        initial={false}
                        whileHover={reduced ? undefined : { clipPath: 'inset(0 0 0 0)', y: -8 }}
                        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                        <div className="usage-browser-bar">
                            <PostdotLogo />
                            <span>postdot / studio</span>
                            <i />
                            <i />
                            <i />
                        </div>
                        <div className="usage-studio-images">
                            <ProductImage
                                className="usage-image-light"
                                name="compose-light"
                                alt="Postdot Studio: composing a post with an X preview"
                                width="1440"
                                height="1000"
                            />
                            <ProductImage
                                className="usage-image-dark"
                                name="compose-dark"
                                alt="Postdot Studio: composing a post with an X preview"
                                width="1440"
                                height="1000"
                            />
                        </div>
                    </motion.div>
                    <span className="usage-studio-index" aria-hidden="true">
                        For the hands-on.
                    </span>
                </article>
                <article className="usage-mcp">
                    <div className="usage-caption">
                        <span className="usage-status" data-status="available">
                            Available
                        </span>
                        <h3>MCP</h3>
                        <p>Your agent’s way in.</p>
                    </div>
                    <motion.div
                        className="usage-mcp-mark"
                        style={{ rotate: reduced ? 0 : protocolRotate }}>
                        <Mcp aria-hidden="true" />
                    </motion.div>
                    <div className="usage-agent-prompt">
                        <span aria-hidden="true">“</span>Prepare next week’s posts.
                        <span aria-hidden="true">”</span>
                    </div>
                    <span className="usage-medium">Model Context Protocol</span>
                </article>
                <article className="usage-n8n">
                    <div className="usage-caption">
                        <span className="usage-status" data-status="available">
                            Alpha
                        </span>
                        <h3>n8n</h3>
                        <p>Publishing, in your flow.</p>
                    </div>
                    <WorkflowIllustration />
                    <span className="usage-medium">Workflow integration</span>
                </article>
                <article
                    className="usage-cli usage-small"
                    onPointerEnter={() => setTerminalRun(value => value + 1)}>
                    <div className="usage-small-heading">
                        <span className="usage-status" data-status="available">
                            Available
                        </span>
                        <h3>CLI & API</h3>
                        <p>Make it part of your toolkit.</p>
                    </div>
                    <div
                        ref={terminal}
                        className="usage-terminal"
                        data-playing={terminalVisible && !reduced}>
                        <div className="usage-terminal-head">
                            <span className="usage-window-controls" aria-hidden="true">
                                <i />
                                <i />
                                <i />
                            </span>
                            <span>postdot — terminal</span>
                            <button
                                aria-label="Replay terminal animation"
                                title="Replay terminal animation"
                                className="usage-terminal-replay"
                                onClick={() => setTerminalRun(value => value + 1)}>
                                <RestartIcon size={13} />
                            </button>
                        </div>
                        <div key={terminalRun} className="usage-terminal-body">
                            <div className="usage-command-line">
                                <span aria-hidden="true">$</span>
                                <code>bun run postdot --help</code>
                                <span className="usage-terminal-cursor" aria-hidden="true" />
                            </div>
                            <div
                                className="usage-help-output"
                                aria-label="Illustrative terminal showing an excerpt from CLI help">
                                <strong>Postdot CLI</strong>
                                <span>Resources:</span>
                                <div>
                                    <code>projects list</code>
                                    <span>List projects</span>
                                </div>
                                <div>
                                    <code>media list</code>
                                    <span>List media</span>
                                </div>
                                <div>
                                    <code>posts create</code>
                                    <span>Create a draft</span>
                                </div>
                            </div>
                            <div className="usage-terminal-ready" aria-hidden="true">
                                <span>$</span>
                                <i />
                            </div>
                        </div>
                    </div>
                </article>
                <motion.article
                    className="usage-skills usage-small"
                    initial="rest"
                    whileHover={reduced ? 'rest' : 'hovered'}
                    whileInView={reduced ? 'rest' : 'open'}
                    viewport={{ once: true, amount: 0.7 }}>
                    <div className="usage-small-heading">
                        <span className="usage-status" data-status="launch">
                            Launch target
                        </span>
                        <h3>Agent skills</h3>
                        <p>Give your agent the know-how.</p>
                    </div>
                    <div className="usage-skill-deck" aria-hidden="true">
                        <motion.div
                            className="usage-skill-sheet usage-skill-sheet-back"
                            variants={{
                                rest: { rotate: 0, x: 0 },
                                open: { rotate: -12, x: -32 },
                                hovered: { rotate: -17, x: -40 },
                            }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
                            <span>Review</span>
                            <i />
                            <i />
                            <i />
                        </motion.div>
                        <motion.div
                            className="usage-skill-sheet usage-skill-sheet-middle"
                            variants={{
                                rest: { rotate: 0, x: 0 },
                                open: { rotate: 9, x: 32 },
                                hovered: { rotate: 14, x: 40 },
                            }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
                            <span>Schedule</span>
                            <i />
                            <i />
                            <i />
                        </motion.div>
                        <motion.div
                            className="usage-skill-sheet usage-skill-sheet-front"
                            variants={{ rest: { y: 12 }, open: { y: 0 } }}
                            transition={{ duration: 0.6 }}>
                            <span>SKILL.md</span>
                            <strong>
                                Publish
                                <br />
                                with Postdot.
                            </strong>
                            <div>
                                <i />
                                <i />
                            </div>
                        </motion.div>
                    </div>
                </motion.article>
                <motion.article
                    className="usage-mobile usage-small"
                    initial="rest"
                    whileHover={reduced ? 'rest' : 'hovered'}
                    whileInView={reduced ? 'rest' : 'open'}
                    viewport={{ once: true, amount: 0.7 }}>
                    <div className="usage-small-heading">
                        <span className="usage-status" data-status="future">
                            Future
                        </span>
                        <h3>Mobile</h3>
                        <p>Take your workspace with you.</p>
                    </div>
                    <motion.div
                        className="usage-phone"
                        aria-hidden="true"
                        variants={{
                            rest: { y: 30, rotate: 9 },
                            open: { y: 0, rotate: -6 },
                            hovered: { y: -8, rotate: -11 },
                        }}
                        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                        <span className="usage-phone-camera" />
                        <PostdotLogo />
                        <span className="usage-phone-home" />
                    </motion.div>
                </motion.article>
            </div>
            <p className="usage-study-note">
                Studio, CLI/API, MCP and the n8n alpha exist today. Skills and mobile show the
                direction ahead.
            </p>
        </section>
    )
}
