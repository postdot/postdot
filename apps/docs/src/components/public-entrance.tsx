'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/** Only below-fold content enters. The initial viewport never repositions after hydration. */
export function PublicEntrance({
    children,
    kind = 'surface',
    className = '',
}: {
    children: ReactNode
    kind?: 'surface' | 'illustration' | 'copy'
    className?: string
}) {
    const host = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const node = host.current
        if (
            !node ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
            node.getBoundingClientRect().top < innerHeight
        )
            return
        let animation: Animation | undefined
        const observer = new IntersectionObserver(
            entries => {
                if (!entries.some(entry => entry.isIntersecting)) return
                const frames: Keyframe[] =
                    kind === 'illustration'
                        ? [{ clipPath: 'inset(0 85% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }]
                        : kind === 'copy'
                          ? [
                                { opacity: 0.25, transform: 'translateX(-18px)' },
                                { opacity: 1, transform: 'translateX(0)' },
                            ]
                          : [
                                {
                                    opacity: 0.35,
                                    transform: 'perspective(1200px) rotateX(4deg) translateY(28px)',
                                },
                                {
                                    opacity: 1,
                                    transform: 'perspective(1200px) rotateX(0deg) translateY(0)',
                                },
                            ]
                animation = node.animate(frames, {
                    duration: kind === 'illustration' ? 900 : 650,
                    easing: 'cubic-bezier(.16,1,.3,1)',
                })
                observer.disconnect()
            },
            { threshold: 0.08 }
        )
        observer.observe(node)
        return () => {
            observer.disconnect()
            animation?.cancel()
        }
    }, [kind])
    return (
        <div ref={host} className={className}>
            {children}
        </div>
    )
}
