import { useRouterState } from '@tanstack/react-router'
import { ReactLenis } from 'lenis/react'
import { useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import 'lenis/dist/lenis.css'

export function PublicScroll({ children }: { children: ReactNode }) {
    const reducedMotion = useReducedMotion()
    const pathname = useRouterState({ select: state => state.location.pathname })
    if (reducedMotion || pathname.startsWith('/docs')) return children
    return (
        <ReactLenis
            root
            options={{ autoRaf: true, anchors: { offset: -96 }, allowNestedScroll: true }}>
            {children}
        </ReactLenis>
    )
}
