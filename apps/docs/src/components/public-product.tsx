'use client'

import { useLenis } from 'lenis/react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { useEffect, useRef, useState, type UIEvent } from 'react'

import './public-product.css'

const views = [
    {
        name: 'compose',
        label: 'Compose',
        description: 'Prepare one post. Adapt each destination.',
        alt: 'Postbot Studio composing a post with destination previews',
    },
    {
        name: 'queue',
        label: 'Queue',
        description: 'Follow what is ready, scheduled or needs attention.',
        alt: 'Postbot publication queue with destination states and scheduled times',
    },
    {
        name: 'calendar',
        label: 'Calendar',
        description: 'See your publications across the week ahead.',
        alt: 'Postbot publication calendar showing the publishing schedule',
    },
] as const

export function PublicProduct() {
    const scene = useRef<HTMLDivElement>(null)
    const images = useRef<HTMLDivElement>(null)
    const [active, setActive] = useState(0)
    const [manual, setManual] = useState(false)
    const reduced = useReducedMotion()
    const lenis = useLenis()
    const { scrollYProgress } = useScroll({ target: scene, offset: ['start start', 'end end'] })
    useEffect(() => {
        const query = window.matchMedia(
            '(max-width: 900px), (max-height: 699px), (prefers-reduced-motion: reduce)'
        )
        const update = () => {
            setManual(query.matches)
            if (query.matches) {
                setActive(0)
                images.current?.scrollTo({ left: 0, behavior: 'instant' })
            }
        }
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])
    useMotionValueEvent(scrollYProgress, 'change', value => {
        if (!manual && !reduced) setActive(Math.min(2, Math.max(0, Math.floor(value * 3))))
    })
    function choose(index: number) {
        setActive(index)
        if (manual || reduced) {
            images.current?.scrollTo({
                left: index * images.current.clientWidth,
                behavior: reduced ? 'instant' : 'smooth',
            })
            return
        }
        const node = scene.current
        if (!node) return
        const top = node.getBoundingClientRect().top + window.scrollY
        const target =
            top + Math.max(0, node.offsetHeight - window.innerHeight) * ((index + 0.2) / 3)
        if (lenis) lenis.scrollTo(target, { duration: 0.6 })
        else window.scrollTo({ top: target, behavior: 'smooth' })
    }
    function onStripScroll(event: UIEvent<HTMLDivElement>) {
        if (!manual && !reduced) return
        const node = event.currentTarget
        setActive(
            Math.max(0, Math.min(2, Math.round(node.scrollLeft / Math.max(1, node.clientWidth))))
        )
    }
    return (
        <div
            ref={scene}
            id="studio-tour"
            role="region"
            className="home-product-scene home-studio-tour"
            aria-label="Explore three views of Postbot Studio">
            <figure className="home-tour-sticky">
                <div
                    className="home-tour-images home-product-window"
                    ref={images}
                    onScroll={onStripScroll}>
                    {views.map((view, index) => (
                        <div
                            id={`studio-view-${view.name}`}
                            key={view.name}
                            className="home-tour-slide"
                            data-active={active === index}
                            aria-hidden={active !== index}>
                            <img
                                className="home-shot home-shot-light"
                                src={`/product/${view.name}-light.webp`}
                                alt={`${view.alt}, using an example project`}
                                width="1440"
                                height="1000"
                                loading={index === 0 ? 'eager' : 'lazy'}
                                fetchPriority={index === 0 ? 'high' : 'low'}
                                decoding="async"
                                draggable={false}
                            />
                            <img
                                className="home-shot home-shot-dark"
                                src={`/product/${view.name}-dark.webp`}
                                alt={`${view.alt} in dark mode, using an example project`}
                                width="1440"
                                height="1000"
                                loading={index === 0 ? 'eager' : 'lazy'}
                                fetchPriority={index === 0 ? 'high' : 'low'}
                                decoding="async"
                                draggable={false}
                            />
                        </div>
                    ))}
                </div>
                <figcaption className="home-tour-caption">
                    <div className="home-tour-navigation" role="group" aria-label="Studio views">
                        {views.map((view, index) => (
                            <button
                                type="button"
                                key={view.name}
                                aria-pressed={active === index}
                                aria-controls={`studio-view-${view.name}`}
                                onClick={() => choose(index)}>
                                {view.label}
                            </button>
                        ))}
                        <a href="#networks" className="home-tour-skip">
                            Skip tour
                        </a>
                    </div>
                    <p>{(views[active] ?? views[0]).description}</p>
                </figcaption>
            </figure>
        </div>
    )
}
