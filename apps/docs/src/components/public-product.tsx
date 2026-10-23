import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import './public-product.css'
import { ProductImage } from './product-image'

const views = [
    {
        name: 'compose',
        label: 'Prepare your next publication.',
        description: 'Prepare one post. Adapt each destination.',
        alt: 'Postdot Studio composing a post with destination previews',
    },
    {
        name: 'queue',
        label: 'Know what is going out.',
        description: 'Follow what is ready, scheduled or needs attention.',
        alt: 'Postdot publication queue with destination states and scheduled times',
    },
    {
        name: 'calendar',
        label: 'Make room for what comes next.',
        description: 'See your publications across the week ahead.',
        alt: 'Postdot publication calendar showing the publishing schedule',
    },
] as const

export function PublicProduct() {
    const scene = useRef<HTMLDivElement>(null)
    const [active, setActive] = useState(0)
    const [revealed, setRevealed] = useState(false)
    const [manual, setManual] = useState(false)
    const reduced = useReducedMotion()
    const { scrollYProgress } = useScroll({ target: scene, offset: ['start start', 'end end'] })
    useEffect(() => {
        const query = window.matchMedia(
            '(max-width: 900px), (max-height: 699px), (prefers-reduced-motion: reduce)'
        )
        const update = () => setManual(query.matches)
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])
    useMotionValueEvent(scrollYProgress, 'change', value => {
        if (manual || reduced) return
        setRevealed(value > 0.06)
        setActive(value < 0.38 ? 0 : value < 0.7 ? 1 : 2)
    })
    return (
        <div
            ref={scene}
            id="studio-tour"
            role="region"
            className="home-product-scene home-studio-tour"
            aria-label="Explore three views of Postdot Studio">
            <div className="home-tour-sticky" data-revealed={revealed}>
                <div className="home-tour-slides">
                    {views.map((view, index) => (
                        <figure
                            id={`studio-view-${view.name}`}
                            key={view.name}
                            className="home-tour-slide"
                            data-active={active === index}
                            data-position={index < active ? 'before' : 'after'}
                            aria-hidden={manual || reduced ? undefined : active !== index}>
                            <figcaption className="home-tour-caption">
                                <h2>{view.label}</h2>
                                <p>{view.description}</p>
                            </figcaption>
                            <div className="home-tour-images home-product-window">
                                <ProductImage
                                    className="home-shot home-shot-light"
                                    name={`${view.name}-light`}
                                    alt={`${view.alt}, using an example project`}
                                    width="1440"
                                    height="1000"
                                    loading={index === 0 ? 'eager' : 'lazy'}
                                    fetchPriority={index === 0 ? 'high' : 'low'}
                                    decoding="async"
                                    draggable={false}
                                />
                                <ProductImage
                                    className="home-shot home-shot-dark"
                                    name={`${view.name}-dark`}
                                    alt={`${view.alt} in dark mode, using an example project`}
                                    width="1440"
                                    height="1000"
                                    loading={index === 0 ? 'eager' : 'lazy'}
                                    fetchPriority={index === 0 ? 'high' : 'low'}
                                    decoding="async"
                                    draggable={false}
                                />
                            </div>
                        </figure>
                    ))}
                </div>
            </div>
        </div>
    )
}
