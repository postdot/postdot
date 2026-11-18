import { Avatar as DiceBearAvatar, Style } from '@dicebear/core'
import lorelei from '@dicebear/styles/lorelei.json' with { type: 'json' }
import blueskyIcon from '@iconify-icons/logos/bluesky'
import devIcon from '@iconify-icons/logos/dev-icon'
import discordIcon from '@iconify-icons/logos/discord-icon'
import facebookIcon from '@iconify-icons/logos/facebook'
import instagramIcon from '@iconify-icons/logos/instagram-icon'
import linkedinIcon from '@iconify-icons/logos/linkedin-icon'
import mastodonIcon from '@iconify-icons/logos/mastodon-icon'
import telegramIcon from '@iconify-icons/logos/telegram'
import xIcon from '@iconify-icons/logos/x'
import { Icon } from '@iconify/react'
import { Avatar, AvatarFallback, AvatarImage } from '@postdot/ui/components/avatar'
import { cn } from '@postdot/ui/lib/utils'
import { useMemo, type HTMLAttributes } from 'react'

import type { Channel } from '@/lib/api'
import { useChannelVariant, useChannelImage } from '@/lib/channel-identity-context'

const userStyle = new Style(lorelei)

const channelIcons = {
    bluesky: blueskyIcon,
    devto: devIcon,
    discord: discordIcon,
    facebook: facebookIcon,
    instagram: instagramIcon,
    telegram: telegramIcon,
    linkedin: linkedinIcon,
    mastodon: mastodonIcon,
    x: xIcon,
} as const

type ChannelIdentity = Pick<Channel, 'id' | 'name' | 'profileId' | 'imageUrl'>
type ChannelAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

export function ResourceAvatar({
    imageUrl,
    kind,
    name,
    seed = name,
    size = 'sm',
}: {
    readonly imageUrl?: string | null
    readonly kind: 'workspace' | 'project'
    readonly name: string
    readonly seed?: string
    readonly size?: 'sm' | 'lg'
}) {
    return (
        <MonogramAvatar
            data-resource-avatar="true"
            data-resource-kind={kind}
            className={cn(
                size === 'lg' ? 'size-10 text-sm' : 'size-6 text-[10px]',
                kind === 'workspace' ? 'rounded-full' : 'rounded-md'
            )}
            imageUrl={imageUrl}
            name={name}
            seed={`${kind}:${seed}`}
        />
    )
}

/**
 * Identity that helps tell objects apart: an uploaded image when there is one,
 * otherwise the object's initials on a colour derived from its identity.
 */
export function MonogramAvatar({
    className,
    imageUrl,
    name,
    seed = name,
    ...props
}: {
    readonly className?: string
    readonly imageUrl?: string | null
    readonly name: string
    readonly seed?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
    const hue = identityHue(seed)
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold leading-none tracking-tight text-white select-none',
                className
            )}
            style={
                imageUrl
                    ? undefined
                    : {
                          backgroundImage: `linear-gradient(135deg, oklch(0.64 0.13 ${hue}), oklch(0.5 0.14 ${(hue + 35) % 360}))`,
                      }
            }
            {...props}>
            {imageUrl ? (
                <img alt="" className="size-full bg-white object-contain" src={imageUrl} />
            ) : (
                identityInitials(name)
            )}
        </span>
    )
}

/** "Spring launch" → "SL", "Newsroom" → "N". */
export function identityInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const letters =
        words.length > 1
            ? [words[0], words[1]].map(word => Array.from(word!)[0] ?? '')
            : [Array.from(words[0] ?? '')[0] ?? '']
    return letters.join('').toLocaleUpperCase() || '·'
}

function identityHue(seed: string): number {
    let hash = 2166136261
    for (const character of seed) {
        hash ^= character.codePointAt(0) ?? 0
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0) % 360
}

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
    const variant = useChannelVariant(channel.id)
    const storedImage = useChannelImage(channel.id)

    return (
        <span
            aria-hidden="true"
            data-channel-avatar="true"
            data-channel-profile={channel.profileId}
            className={cn(
                'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md',
                channelAvatarSizeClass[size],
                icon === undefined ? undefined : 'bg-white',
                className
            )}
            {...props}>
            {icon !== undefined ? (
                <Icon icon={icon} className={channelLogoSizeClass[size]} />
            ) : (
                <MonogramAvatar
                    className={cn('size-full', channelInitialsSizeClass[size])}
                    name={channel.name}
                    imageUrl={channel.imageUrl === undefined ? storedImage : channel.imageUrl}
                    seed={`channel:${channel.id}`}
                />
            )}
            {icon !== undefined && variant !== undefined && size !== 'xs' ? (
                <span
                    data-channel-variant={variant}
                    className="absolute bottom-0 right-0 rounded-tl-sm bg-[#171717] px-1 text-[9px] font-semibold leading-3 text-white">
                    {variant}
                </span>
            ) : null}
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
    xs: 'size-4 rounded-[0.25rem]',
    sm: 'size-6',
    md: 'size-8',
    lg: 'size-10',
}

const channelInitialsSizeClass: Record<ChannelAvatarSize, string> = {
    xs: 'text-[7px]',
    sm: 'text-[10px]',
    md: 'text-xs',
    lg: 'text-sm',
}

const channelLogoSizeClass: Record<ChannelAvatarSize, string> = {
    xs: 'size-3',
    sm: 'size-4',
    md: 'size-5',
    lg: 'size-6',
}
