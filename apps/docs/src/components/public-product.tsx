'use client'

import { motion, useReducedMotion } from 'motion/react'

export function PublicProduct() {
    const reduced = useReducedMotion()
    return (
        <figure className="home-product-scene">
            <motion.div
                className="home-product-window"
                initial={false}
                whileHover={reduced ? undefined : { scale: 1.005 }}
                transition={{ duration: 0.5 }}>
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
