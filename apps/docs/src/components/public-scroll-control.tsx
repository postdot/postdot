'use client'

import { Button } from '@postbot/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@postbot/ui/components/tooltip'
import { ArrowUpIcon } from '@solar-icons/react/linear/arrow-up'
import { useLenis } from 'lenis/react'
import {
    motion,
    useMotionValueEvent,
    useReducedMotion,
    useScroll,
    useTransform,
} from 'motion/react'
import { useState } from 'react'

export function PublicScrollControl() {
    const { scrollY, scrollYProgress } = useScroll()
    const [visible, setVisible] = useState(false)
    const reduced = useReducedMotion()
    const lenis = useLenis()
    const progress = useTransform(scrollYProgress, value => `${value * 100}%`)
    useMotionValueEvent(scrollY, 'change', value => setVisible(value > 480))
    return (
        <motion.div
            className="home-scroll-control"
            animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 12 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            style={{ pointerEvents: visible ? 'auto' : 'none' }}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            variant="ghost"
                            aria-label="Back to top"
                            tabIndex={visible ? 0 : -1}
                            className="home-scroll-button"
                            onClick={() => {
                                if (lenis && !reduced) lenis.scrollTo(0)
                                else window.scrollTo({ top: 0, behavior: 'instant' })
                            }}
                        />
                    }>
                    <ArrowUpIcon size={19} aria-hidden="true" />
                    <span className="home-reading-track" aria-hidden="true">
                        <motion.span style={{ height: progress }} />
                    </span>
                </TooltipTrigger>
                <TooltipContent className="home-theme-tooltip">Back to top</TooltipContent>
            </Tooltip>
        </motion.div>
    )
}
