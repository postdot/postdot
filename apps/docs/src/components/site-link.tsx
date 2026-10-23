import { Link as RouterLink } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

type SiteLinkProps = Omit<ComponentProps<'a'>, 'href'> & { href: string }

/**
 * Link taking a plain `href`, as the shared components expect. Same-site
 * paths go through the router; anchors and other origins stay anchors.
 */
export function Link({ href, children, ...props }: SiteLinkProps) {
    if (!href.startsWith('/') || href.startsWith('//')) {
        return (
            <a href={href} {...props}>
                {children}
            </a>
        )
    }
    const url = new URL(href, 'https://postdot.invalid')
    const to = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '/'
    return (
        <RouterLink
            to={to}
            hash={url.hash.slice(1) || undefined}
            search={url.search ? Object.fromEntries(url.searchParams) : undefined}
            {...props}>
            {children}
        </RouterLink>
    )
}
