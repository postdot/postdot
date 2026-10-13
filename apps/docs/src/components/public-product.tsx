'use client'

import { motion, useReducedMotion } from 'motion/react'

export function PublicProduct() {
    const reducedMotion = useReducedMotion()
    return (
        <motion.figure
            className="home-product"
            initial={false}
            whileInView={{ y: 0 }}
            style={{ y: reducedMotion ? 0 : 24 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}>
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
        </motion.figure>
    )
}
