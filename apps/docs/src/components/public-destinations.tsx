import bluesky from '@iconify-icons/logos/bluesky'
import discord from '@iconify-icons/logos/discord-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import mastodon from '@iconify-icons/logos/mastodon-icon'
import x from '@iconify-icons/logos/x'
import Link from 'next/link'

const providers = [
    { name: 'Bluesky', icon: bluesky },
    { name: 'Discord', icon: discord },
    { name: 'LinkedIn', icon: linkedin },
    { name: 'Mastodon', icon: mastodon },
    { name: 'X', icon: x },
]

export function PublicDestinations() {
    return (
        <div className="home-destinations">
            <ul aria-label="Supported connected channels">
                {providers.map(provider => (
                    <li
                        key={provider.name}
                        className={provider.name === 'X' ? 'home-provider-x' : undefined}>
                        <svg
                            viewBox={`0 0 ${provider.icon.width} ${provider.icon.height}`}
                            width={28}
                            height={28}
                            aria-hidden="true"
                            dangerouslySetInnerHTML={{ __html: provider.icon.body }}
                        />
                        <span>{provider.name}</span>
                    </li>
                ))}
                <li>
                    <span className="home-dev-mark" aria-hidden="true">
                        DEV
                    </span>
                    <span>DEV.to</span>
                </li>
            </ul>
            <Link href="/docs/providers/">Connected, manual and custom destinations</Link>
        </div>
    )
}
