import type { SVGProps } from 'react'
import Cookie from '~icons/ph/cookie'

/** Phosphor cookie from Iconify: Solar has none yet (saoudi-h/solar-icons#631). */
export function CookieIcon({ size = 20, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
    return <Cookie width={size} height={size} aria-hidden="true" {...props} />
}
