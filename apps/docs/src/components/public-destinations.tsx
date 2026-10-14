'use client'

import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import x from '@iconify-icons/logos/x'
import { useInView } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

const providers = [
    { name: 'Bluesky', icon: bluesky },
    { name: 'Discord', icon: discord },
    { name: 'LinkedIn', icon: linkedin },
    { name: 'Mastodon', icon: mastodon },
    { name: 'X', icon: x },
]

export function PublicDestinations() {
    const ref = useRef<HTMLDivElement>(null)
    const inView = useInView(ref)
    const [paused, setPaused] = useState(false)
    const [visible, setVisible] = useState(true)
    useEffect(() => {
        const update = () => setVisible(!document.hidden)
        update()
        document.addEventListener('visibilitychange', update)
        return () => document.removeEventListener('visibilitychange', update)
    }, [])
    return (
        <section className="home-connections" aria-labelledby="home-connections-title">
            <div className="home-connections-heading">
                <h2 id="home-connections-title">
                    Your next post.
                    <br />
                    On your networks.
                </h2>
                <Link href="/docs/providers/">Connection guides</Link>
            </div>
            <div
                ref={ref}
                className="home-connections-marquee"
                data-paused={paused || !inView || !visible}>
                <div className="home-connections-track">
                    {[0, 1].map(copy => (
                        <ul
                            key={copy}
                            aria-label={copy === 0 ? 'Supported connected channels' : undefined}
                            className="home-connections-list"
                            aria-hidden={copy === 1}>
                            {providers.map(provider => (
                                <li
                                    key={provider.name}
                                    className={
                                        provider.name === 'X' ? 'home-provider-x' : undefined
                                    }>
                                    <span className="home-provider-symbol">
                                        <svg
                                            viewBox={`0 0 ${provider.icon.width} ${provider.icon.height}`}
                                            width={28}
                                            height={28}
                                            aria-hidden="true"
                                            dangerouslySetInnerHTML={{ __html: provider.icon.body }}
                                        />
                                    </span>
                                    <span>{provider.name}</span>
                                </li>
                            ))}
                            <li>
                                <span className="home-provider-symbol">
                                    <span className="home-dev-mark" aria-hidden="true">
                                        DEV
                                    </span>
                                </span>
                                <span>DEV.to</span>
                            </li>
                        </ul>
                    ))}
                </div>
            </div>
            <button
                className="home-connections-pause"
                type="button"
                aria-pressed={paused}
                onClick={() => setPaused(value => !value)}>
                {paused ? 'Resume' : 'Pause'}
                <span className="sr-only"> network animation</span>
            </button>
        </section>
    )
}
