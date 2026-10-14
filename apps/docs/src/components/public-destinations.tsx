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
        <div className="home-destinations">
            <ul aria-label="Supported connected channels">
                {providers.map((provider, index) => (
                    <motion.li
                        initial={false}
                        whileInView={{ y: 0 }}
                        style={{ y: reduced ? 0 : 18 }}
                        viewport={{ once: true }}
                        transition={{
                            duration: reduced ? 0 : 0.5,
                            delay: reduced ? 0 : index * 0.045,
                        }}
                        whileHover={reduced ? undefined : { y: -5 }}
                        key={provider.name}
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
                <motion.li whileHover={reduced ? undefined : { y: -5 }}>
                    <span className="home-dev-mark" aria-hidden="true">
                        DEV
                    </span>
                    <span>DEV.to</span>
                </motion.li>
            </ul>
            <Link href="/docs/providers/">Explore the connections</Link>
        </div>
    )
}
