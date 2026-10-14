'use client'

import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import facebook from '@iconify-icons/logos/facebook'
import instagram from '@iconify-icons/logos/instagram-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import telegram from '@iconify-icons/logos/telegram'
import x from '@iconify-icons/logos/x'
import youtube from '@iconify-icons/logos/youtube-icon'
import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const providers = [
    { name: 'Bluesky', icon: bluesky },
    { name: 'Discord', icon: discord },
    { name: 'LinkedIn', icon: linkedin },
    { name: 'Mastodon', icon: mastodon },
    { name: 'X', icon: x },
    { name: 'Telegram', icon: telegram, upcoming: true },
    { name: 'Facebook', icon: facebook, upcoming: true },
    { name: 'Instagram', icon: instagram, upcoming: true },
    { name: 'YouTube', icon: youtube, upcoming: true },
]

export function PublicDestinations() {
    const ref = useRef<HTMLDivElement>(null)
    const inView = useInView(ref)
    const [visible, setVisible] = useState(true)
    useEffect(() => {
        const update = () => setVisible(!document.hidden)
        update()
        document.addEventListener('visibilitychange', update)
        return () => document.removeEventListener('visibilitychange', update)
    }, [])
    return (
        <div className="home-connections" aria-label="Social network integrations">
            <p className="home-connections-caption">Connect your networks.</p>
            <div
                ref={ref}
                className="home-connections-marquee"
                data-paused={!inView || !visible}
                tabIndex={0}
                aria-label="Network integrations. Focus or hover to stop scrolling.">
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
                                    data-upcoming={provider.upcoming || undefined}
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
                                    <span className="home-provider-name">
                                        {provider.name}
                                        {provider.upcoming && <small>Coming soon</small>}
                                    </span>
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
        </div>
    )
}
