import type { SVGProps } from 'react'

import { cn } from '../lib/utils'

/** Theme-aware mark; named parts support future explicitly designed motion. */
function PostdotLogo({ className, 'aria-label': ariaLabel, ...props }: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 128 128"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn('block', className)}
            aria-label={ariaLabel}
            aria-hidden={ariaLabel === undefined ? true : undefined}
            role={ariaLabel === undefined ? undefined : 'img'}
            {...props}>
            <path
                opacity="0.5"
                d="M109.774 76.0527C109.774 95.6718 89.28 111.576 63.9998 111.576C38.7195 111.576 18.2256 95.6718 18.2256 76.0527H109.774Z"
                fill="currentColor"
                data-part="face"
            />
            <path
                d="M63.9998 16.4235C89.28 16.4237 109.774 36.9172 109.774 62.1974C109.774 62.255 109.773 62.3127 109.773 62.3703H89.6969V47.5175C89.6969 41.1748 84.5551 36.0331 78.2125 36.033C71.8698 36.033 66.7281 41.1748 66.7281 47.5175V62.3703H18.2266C18.2264 62.3127 18.2256 62.255 18.2256 62.1974C18.2256 36.9171 38.7195 16.4235 63.9998 16.4235Z"
                fill="currentColor"
                data-part="cap"
            />
            <path
                d="M118.762 66.1583C121.494 66.1583 123.709 68.3732 123.709 71.1055C123.709 73.8377 121.494 76.0526 118.762 76.0526H9.23865C6.50642 76.0526 4.2915 73.8377 4.2915 71.1055C4.2915 68.3732 6.50642 66.1583 9.23865 66.1583H118.762Z"
                fill="currentColor"
                data-part="brim"
            />
            <path
                d="M100.716 79.2872C100.716 85.361 97.1138 90.2848 92.6698 90.2848C88.2257 90.2848 84.623 85.361 84.623 79.2872C84.623 73.2134 88.2257 68.2896 92.6698 68.2896C97.1138 68.2896 100.716 73.2134 100.716 79.2872Z"
                fill="currentColor"
                data-part="eye-right"
            />
            <path
                d="M74.8395 79.2872C74.8395 85.361 71.2369 90.2848 66.7928 90.2848C62.3487 90.2848 58.7461 85.361 58.7461 79.2872C58.7461 73.2134 62.3487 68.2896 66.7928 68.2896C71.2369 68.2896 74.8395 73.2134 74.8395 79.2872Z"
                fill="currentColor"
                data-part="eye-left"
            />
        </svg>
    )
}
export { PostdotLogo }
