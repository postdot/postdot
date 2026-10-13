'use client'

import { Button } from '@postbot/ui/components/button'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

export function PublicClients() {
    const [client, setClient] = useState<'web' | 'cli'>('web')
    const reducedMotion = useReducedMotion()
    const [title, setTitle] = useState('Release announcement')
    const [body, setBody] = useState('The release is ready.')
    const command = 'bun run postbot posts create --project "$PROJECT_ID" --input post.json --json'
    const payload = JSON.stringify(
        {
            title,
            sourceContent: {
                body: { text: body, format: 'plain_text' },
                media: [],
            },
            publications: [
                {
                    channelId: 'YOUR_CHANNEL_ID',
                    deliveryMode: 'manual',
                    targetContent: { body, media: [] },
                },
            ],
        },
        null,
        2
    )
    return (
        <div className="home-clients">
            <div className="home-client-selector" role="group" aria-label="Choose a client">
                <Button
                    variant="ghost"
                    aria-pressed={client === 'web'}
                    onClick={() => setClient('web')}>
                    Web
                </Button>
                <Button
                    variant="ghost"
                    aria-pressed={client === 'cli'}
                    onClick={() => setClient('cli')}>
                    CLI
                </Button>
                <span className="home-client-future">
                    MCP <span>Planned</span>
                </span>
            </div>
            <div className="home-client-stage">
                <motion.div
                    key={client}
                    className="home-client-view"
                    initial={{ opacity: reducedMotion ? 1 : 0.6, y: reducedMotion ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reducedMotion ? 0 : 0.2 }}>
                    {client === 'web' ? (
                        <div className="home-client-browser">
                            <div className="home-client-bar">
                                <span>Postbot</span>
                                <span>Composer</span>
                            </div>
                            <div className="home-client-draft">
                                <span className="home-client-caption">Example draft</span>
                                <input
                                    className="home-demo-title"
                                    aria-label="Example post title"
                                    value={title}
                                    onChange={event => setTitle(event.target.value)}
                                    maxLength={120}
                                />
                                <textarea
                                    className="home-demo-body"
                                    aria-label="Example post content"
                                    value={body}
                                    onChange={event => setBody(event.target.value)}
                                    maxLength={1000}
                                />
                                <div className="home-client-destination">
                                    <span>Manual channel</span>
                                    <span>Draft</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="home-client-terminal">
                            <div className="home-client-bar">
                                <span>Terminal</span>
                                <span>Example input</span>
                            </div>
                            <pre className="home-client-command">
                                <code>{command}</code>
                            </pre>
                            <span className="home-client-filename">post.json</span>
                            <pre>
                                <code>{payload}</code>
                            </pre>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    )
}
