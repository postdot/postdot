'use client'

import mcp from '@iconify-icons/logos/model-context-protocol-icon'
import n8n from '@iconify-icons/logos/n8n-icon'
import { Button } from '@postbot/ui/components/button'
import { CheckReadIcon } from '@solar-icons/react/linear/check-read'
import { CodeSquareIcon } from '@solar-icons/react/linear/code-square'
import { CopyIcon } from '@solar-icons/react/linear/copy'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import Link from 'next/link'
import { useRef, useState } from 'react'

import { PostbotLogo } from './brand'
import { PublicThemeToggle } from './public-theme-toggle'

import './public-home.css'
import './usage-study.css'

function BrandMark({ data }: { data: { width?: number; height?: number; body: string } }) {
    return (
        <svg
            viewBox={`0 0 ${data.width ?? 16} ${data.height ?? 16}`}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: data.body }}
        />
    )
}

export function UsageStudy() {
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState(false)
    const [copying, setCopying] = useState(false)
    async function copyCommand() {
        setCopying(true)
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                navigator.clipboard.writeText('bun run postbot --help'),
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Clipboard unavailable')), 1500)
                }),
            ])
            setCopied(true)
            setCopyError(false)
        } catch {
            setCopyError(true)
        } finally {
            clearTimeout(timeout)
            setCopying(false)
        }
    }
    const stage = useRef<HTMLDivElement>(null)
    const reduced = useReducedMotion()
    const { scrollYProgress } = useScroll({ target: stage, offset: ['start end', 'end start'] })
    const studioY = useTransform(scrollYProgress, [0, 1], [36, -36])
    const protocolRotate = useTransform(scrollYProgress, [0, 1], [-12, 12])
    const workflowX = useTransform(scrollYProgress, [0, 1], [-22, 22])
    return (
        <div className="public-home usage-study">
            <header className="usage-study-nav">
                <Link href="/" aria-label="Postbot home">
                    <PostbotLogo />
                    <span>postbot</span>
                </Link>
                <span>Section study</span>
                <PublicThemeToggle />
            </header>
            <main>
                <section className="usage-section" aria-labelledby="usage-title">
                    <div className="usage-heading">
                        <h1 id="usage-title">
                            Your tools.
                            <br />
                            Your way to publish.
                        </h1>
                        <p>Open the Studio. Bring your agent. Connect your workflows.</p>
                    </div>
                    <div className="usage-gallery" ref={stage}>
                        <article className="usage-studio">
                            <div className="usage-caption">
                                <span className="usage-status" data-status="available">
                                    Available
                                </span>
                                <h2>Studio</h2>
                                <p>A place to make it yours.</p>
                            </div>
                            <motion.div
                                className="usage-browser"
                                style={{ y: reduced ? 0 : studioY }}>
                                <div className="usage-browser-bar">
                                    <PostbotLogo />
                                    <span>postbot / studio</span>
                                    <i />
                                    <i />
                                    <i />
                                </div>
                                <div className="usage-studio-images">
                                    <img
                                        className="usage-image-light"
                                        src="/product/compose-light.webp"
                                        alt="Postbot Studio: composing a post with an X preview"
                                        width="1600"
                                        height="1000"
                                    />
                                    <img
                                        className="usage-image-dark"
                                        src="/product/compose-dark.webp"
                                        alt="Postbot Studio: composing a post with an X preview"
                                        width="1600"
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
                                <span className="usage-status" data-status="planned">
                                    Planned
                                </span>
                                <h2>MCP</h2>
                                <p>Your agent’s way in.</p>
                            </div>
                            <motion.div
                                className="usage-mcp-mark"
                                style={{ rotate: reduced ? 0 : protocolRotate }}>
                                <BrandMark data={mcp} />
                            </motion.div>
                            <div className="usage-agent-prompt">
                                <span aria-hidden="true">“</span>Prepare next week’s posts.
                                <span aria-hidden="true">”</span>
                            </div>
                            <span className="usage-medium">Model Context Protocol</span>
                        </article>
                        <article className="usage-n8n">
                            <div className="usage-caption">
                                <span className="usage-status" data-status="planned">
                                    Planned
                                </span>
                                <h2>n8n</h2>
                                <p>Publishing, in your flow.</p>
                            </div>
                            <motion.div
                                className="usage-workflow"
                                style={{ x: reduced ? 0 : workflowX }}
                                aria-hidden="true">
                                <span className="usage-workflow-source">
                                    <CodeSquareIcon />
                                </span>
                                <span className="usage-workflow-line">
                                    {!reduced && (
                                        <motion.i
                                            initial={{ x: -12, opacity: 0 }}
                                            whileInView={{ x: [-12, 24], opacity: [0, 1, 0] }}
                                            viewport={{ amount: 1 }}
                                            transition={{
                                                duration: 1.8,
                                                repeat: Infinity,
                                                repeatDelay: 0.6,
                                                ease: 'linear',
                                            }}
                                        />
                                    )}
                                </span>
                                <span className="usage-n8n-mark">
                                    <BrandMark data={n8n} />
                                </span>
                                <span className="usage-workflow-line">
                                    {!reduced && (
                                        <motion.i
                                            initial={{ x: -12, opacity: 0 }}
                                            whileInView={{ x: [-12, 24], opacity: [0, 1, 0] }}
                                            viewport={{ amount: 1 }}
                                            transition={{
                                                duration: 1.8,
                                                repeat: Infinity,
                                                repeatDelay: 0.6,
                                                ease: 'linear',
                                            }}
                                        />
                                    )}
                                </span>
                                <span className="usage-workflow-output">
                                    <PostbotLogo />
                                </span>
                            </motion.div>
                            <span className="usage-medium">Workflow integration</span>
                        </article>
                        <article className="usage-cli usage-small">
                            <div className="usage-small-heading">
                                <span className="usage-status" data-status="available">
                                    Available
                                </span>
                                <h2>CLI & API</h2>
                                <p>Make it part of your toolkit.</p>
                            </div>
                            <div className="usage-terminal">
                                <div className="usage-terminal-head">
                                    <span>Terminal</span>
                                    <Button
                                        variant="ghost"
                                        onClick={copyCommand}
                                        className="usage-copy">
                                        {copied ? (
                                            <CheckReadIcon size={13} />
                                        ) : (
                                            <CopyIcon size={13} />
                                        )}
                                        {copying ? 'Copying' : copied ? 'Copied' : 'Copy'}
                                    </Button>
                                </div>
                                <code>
                                    <span className="usage-terminal-prompt" aria-hidden="true">
                                        ${' '}
                                    </span>
                                    bun run postbot --help
                                </code>
                                <motion.div
                                    className="usage-command-options"
                                    initial={false}
                                    whileInView={
                                        reduced ? undefined : { opacity: [0.4, 1], y: [6, 0] }
                                    }
                                    viewport={{ once: true, amount: 1 }}
                                    transition={{ duration: 0.5 }}>
                                    <span>posts</span>
                                    <span>projects</span>
                                    <span>media</span>
                                </motion.div>
                                <span
                                    className={copyError ? 'usage-copy-error' : 'sr-only'}
                                    role="status">
                                    {copyError
                                        ? 'Copy unavailable. Select the command to copy it.'
                                        : copied
                                          ? 'Command copied.'
                                          : ''}
                                </span>
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
                                <h2>Agent skills</h2>
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
                                        with Postbot.
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
                                <h2>Mobile</h2>
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
                                <PostbotLogo />
                                <span className="usage-phone-home" />
                            </motion.div>
                        </motion.article>
                    </div>
                    <p className="usage-study-note">
                        Studio and CLI/API exist today. MCP, skills, n8n and mobile show the
                        direction ahead.
                    </p>
                </section>
            </main>
        </div>
    )
}
