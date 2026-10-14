'use client'

import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import x from '@iconify-icons/logos/x'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'

const providers = [
    { name: 'Bluesky', icon: bluesky },
    { name: 'Discord', icon: discord },
    { name: 'LinkedIn', icon: linkedin },
    { name: 'Mastodon', icon: mastodon },
    { name: 'X', icon: x },
]

export function PublicDestinations() {
    const reduced = useReducedMotion()
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
            <ul aria-label="Supported connected channels" className="home-connections-list">
                {providers.map(provider => (
                    <motion.li
                        key={provider.name}
                        whileHover={reduced ? undefined : { y: -3 }}
                        className={provider.name === 'X' ? 'home-provider-x' : undefined}>
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
                    </motion.li>
                ))}
                <motion.li whileHover={reduced ? undefined : { y: -3 }}>
                    <span className="home-provider-symbol">
                        <span className="home-dev-mark" aria-hidden="true">
                            DEV
                        </span>
                    </span>
                    <span>DEV.to</span>
                </motion.li>
            </ul>
        </section>
    )
}
