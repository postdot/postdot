'use client'

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'

export function PublicProduct() {
    const reduced = useReducedMotion()
    const { scrollY } = useScroll()
    const scale = useTransform(scrollY, [0, 480], [0.88, 1])
    return (
        <figure className="home-product-scene">
            <div className="home-product-ground" aria-hidden="true" />
            <motion.div className="home-product-window" style={{ scale: reduced ? 1 : scale }}>
                <img
                    className="home-shot home-shot-light"
                    src="/product/compose-light.webp"
                    alt="Postbot composer with shared content, destinations and scheduling"
                    width="1440"
                    height="1000"
                    fetchPriority="high"
                />
                <img
                    className="home-shot home-shot-dark"
                    src="/product/compose-dark.webp"
                    alt="Postbot composer in dark mode"
                    width="1440"
                    height="1000"
                    fetchPriority="high"
                />
            </motion.div>
        </figure>
    )
}
