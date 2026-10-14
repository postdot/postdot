'use client'

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'

export function PublicProduct() {
    const scene = useRef<HTMLElement>(null)
    const reducedMotion = useReducedMotion()
    const { scrollYProgress } = useScroll({ target: scene, offset: ['start end', 'center center'] })
    const y = useTransform(scrollYProgress, [0, 1], [28, 0])
    const rotateX = useTransform(scrollYProgress, [0, 1], [4, 0])
    return (
        <figure ref={scene} className="home-product-scene">
            <div className="home-product-ground" aria-hidden="true" />
            <motion.div
                className="home-product-window"
                style={{ y: reducedMotion ? 0 : y, rotateX: reducedMotion ? 0 : rotateX }}>
                <img
                    className="home-shot home-shot-light"
                    src="/product/compose-light.webp"
                    alt="Postbot composer with shared content, destinations and scheduling"
                    width="1440"
                    height="900"
                    fetchPriority="high"
                />
                <img
                    className="home-shot home-shot-dark"
                    src="/product/compose-dark.webp"
                    alt="Postbot composer in dark mode"
                    width="1440"
                    height="900"
                    fetchPriority="high"
                />
            </motion.div>
        </figure>
    )
}
