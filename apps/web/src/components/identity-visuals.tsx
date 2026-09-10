import { Avatar as DiceBearAvatar, Style } from '@dicebear/core'
import lorelei from '@dicebear/styles/lorelei.json' with { type: 'json' }
import shapes from '@dicebear/styles/shapes.json' with { type: 'json' }
import { Avatar, AvatarFallback, AvatarImage } from '@herald/ui/components/avatar'
import { cn } from '@herald/ui/lib/utils'
import blueskyIcon from '@iconify-icons/logos/bluesky'
import devIcon from '@iconify-icons/logos/dev-icon'
import discordIcon from '@iconify-icons/logos/discord-icon'
import linkedinIcon from '@iconify-icons/logos/linkedin-icon'
import mastodonIcon from '@iconify-icons/logos/mastodon-icon'
import xIcon from '@iconify-icons/logos/x'
import { Icon } from '@iconify/react'
import { useMemo, type HTMLAttributes } from 'react'

import type { Channel } from '@/lib/api'

const userStyle = new Style(lorelei)
const channelStyle = new Style(shapes)

const channelIcons = {
    bluesky: blueskyIcon,
    devto: devIcon,
    discord: discordIcon,
    linkedin: linkedinIcon,
    mastodon: mastodonIcon,
    x: xIcon,
} as const

type ChannelIdentity = Pick<Channel, 'id' | 'name' | 'profileId'>
type ChannelAvatarSize = 'sm' | 'md' | 'lg'

export function UserAvatar({
    imageUrl,
    name,
    seed = name,
    size = 'sm',
}: {
    readonly imageUrl?: string | null
    readonly name: string
    readonly seed?: string
    readonly size?: 'sm' | 'default' | 'lg'
}) {
    const generatedImage = useMemo(() => createDiceBearImage(userStyle, seed), [seed])
    const initial = name.trim().charAt(0).toUpperCase() || 'H'

    return (
        <Avatar size={size}>
            <AvatarImage alt="" src={imageUrl?.trim() || generatedImage} />
            <AvatarFallback>
                <img alt="" className="size-full object-cover" src={generatedImage} />
                <span className="sr-only">{initial}</span>
            </AvatarFallback>
        </Avatar>
    )
}

export function ChannelAvatar({
    channel,
    className,
    size = 'md',
    ...props
}: {
    readonly channel: ChannelIdentity
    readonly className?: string
    readonly size?: ChannelAvatarSize
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
    const icon = getChannelIcon(channel.profileId)
    const generatedImage = useMemo(
        () => (icon === undefined ? createDiceBearImage(channelStyle, channel.id) : null),
        [channel.id, icon]
    )

    return (
        <span
            aria-hidden="true"
            data-channel-avatar="true"
            data-channel-profile={channel.profileId}
            className={cn(
                'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md',
                channelAvatarSizeClass[size],
                icon === undefined ? 'bg-primary/10' : 'bg-white',
                className
            )}
            {...props}>
            {icon !== undefined ? (
                <Icon icon={icon} className={channelLogoSizeClass[size]} />
            ) : (
                <img alt="" className="size-full object-cover" src={generatedImage ?? undefined} />
            )}
        </span>
    )
}

export function channelHasBrandIcon(profileId: string) {
    return getChannelIcon(profileId) !== undefined
}

function getChannelIcon(profileId: string) {
    return Object.hasOwn(channelIcons, profileId)
        ? channelIcons[profileId as keyof typeof channelIcons]
        : undefined
}

function createDiceBearImage(style: Style, seed: string) {
    return new DiceBearAvatar(style, {
        backgroundColor: ['b6e3f4', 'c0aede', 'ffd5dc', 'ffdfbf', 'd1f4dc'],
        borderRadius: 22,
        seed,
        size: 128,
    }).toDataUri()
}

const channelAvatarSizeClass: Record<ChannelAvatarSize, string> = {
    sm: 'size-6',
    md: 'size-8',
    lg: 'size-10',
}

const channelLogoSizeClass: Record<ChannelAvatarSize, string> = {
    sm: 'size-4',
    md: 'size-5',
    lg: 'size-6',
}
