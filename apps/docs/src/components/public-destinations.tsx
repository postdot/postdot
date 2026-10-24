import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import Bluesky from '~icons/logos/bluesky'
import Discord from '~icons/logos/discord-icon'
import Facebook from '~icons/logos/facebook'
import Instagram from '~icons/logos/instagram-icon'
import LinkedIn from '~icons/logos/linkedin-icon'
import Mastodon from '~icons/logos/mastodon-icon'
import Telegram from '~icons/logos/telegram'
import X from '~icons/logos/x'
import YouTube from '~icons/logos/youtube-icon'

const providers = [
    { name: 'Bluesky', Icon: Bluesky },
    { name: 'Discord', Icon: Discord },
    { name: 'LinkedIn', Icon: LinkedIn },
    { name: 'Mastodon', Icon: Mastodon },
    { name: 'X', Icon: X },
    { name: 'Telegram', Icon: Telegram, upcoming: true },
    { name: 'Facebook', Icon: Facebook, upcoming: true },
    { name: 'Instagram', Icon: Instagram, upcoming: true },
    { name: 'YouTube', Icon: YouTube, upcoming: true },
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
        <div id="networks" className="home-connections" aria-label="Social network integrations">
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
                                        <provider.Icon width={28} height={28} aria-hidden="true" />
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
