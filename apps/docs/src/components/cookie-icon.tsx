import cookie from '@iconify-icons/ph/cookie'
import type { SVGProps } from 'react'

/** Phosphor cookie from Iconify: Solar has none yet (saoudi-h/solar-icons#631). */
export function CookieIcon({ size = 20, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox={`0 0 ${cookie.width} ${cookie.height}`}
            width={size}
            height={size}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: cookie.body }}
            {...props}
        />
    )
}
