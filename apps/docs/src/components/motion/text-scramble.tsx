'use client'

// Adapted from Motion Primitives TextScramble (MIT, per upstream README).
// https://github.com/ibelick/motion-primitives/blob/main/components/core/text-scramble.tsx
// Keep the default text visible in SSR; animate only on an explicit trigger.
import { useEffect, useState } from 'react'

export function TextScramble({
    children,
    trigger,
    onComplete,
}: {
    children: string
    trigger: boolean
    onComplete: () => void
}) {
    const [scrambledText, setScrambledText] = useState<string | null>(null)
    useEffect(() => {
        if (!trigger) return
        let step = 0
        const steps = 12
        const characterSet = '0123456789'
        const interval = setInterval(() => {
            const progress = step / steps
            setScrambledText(
                [...children]
                    .map((char, index) =>
                        progress * children.length > index
                            ? char
                            : characterSet[Math.floor(Math.random() * characterSet.length)]
                    )
                    .join('')
            )
            step++
            if (step > steps) {
                clearInterval(interval)
                setScrambledText(null)
                onComplete()
            }
        }, 40)
        return () => clearInterval(interval)
    }, [children, trigger, onComplete])
    return <span>{scrambledText ?? children}</span>
}
