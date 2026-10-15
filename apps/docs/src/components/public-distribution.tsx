'use client'

import { useEffect, useRef } from 'react'

import { brands } from '../../public/illustrations/brands.js'
import { sceneAt } from '../../public/illustrations/scene.js'

import './public-distribution.css'

const rest = sceneAt(1)
type Plate = typeof rest.source

function StaticPlate({ plate, index }: { plate: Plate; index?: number }) {
    const brand = index === undefined ? undefined : brands[index]
    return (
        <g>
            <path className="sil" d={plate.shape.sil} />
            <path className="crease" d={plate.shape.crease} />
            <path className="image" d={plate.image} />
            <path className="accent" d={plate.landscape} />
            {plate.lines.map((d: string, i: number) => (
                <path className="rule" d={d} key={i} />
            ))}
            {brand && (
                <svg
                    x={plate.badge[0] - 12}
                    y={plate.badge[1] - 12}
                    width={24}
                    height={24}
                    viewBox={`0 0 ${brand.width} ${brand.height}`}
                    fill="currentColor"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: brand.body }}
                />
            )}
        </g>
    )
}

export function DistributionIllustration() {
    const host = useRef<HTMLDivElement>(null)
    const live = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const element = live.current
        const wrapper = host.current
        if (!element || !wrapper) return
        let disposed = false
        let destroy: (() => void) | undefined
        const observer = new IntersectionObserver(
            entries => {
                if (!entries.some(entry => entry.isIntersecting)) return
                observer.disconnect()
                void import('../../public/illustrations/figure.js')
                    .then(({ mountFigure }) => {
                        if (disposed) return
                        destroy = mountFigure(element)
                        wrapper.dataset.ready = 'true'
                    })
                    .catch(() => {
                        /* The server-rendered frame remains usable if motion cannot load. */
                    })
            },
            { rootMargin: '160px' }
        )
        observer.observe(element)
        return () => {
            disposed = true
            observer.disconnect()
            destroy?.()
            delete wrapper.dataset.ready
        }
    }, [])
    return (
        <div
            className="distribution-art"
            ref={host}
            role="img"
            aria-label="One source post branches into stacked destination versions for X, LinkedIn and Bluesky.">
            <svg className="distribution-still" viewBox="0 0 640 390" aria-hidden="true">
                {rest.destinations.map((item: { route: string }, i: number) => (
                    <path className="connector" d={item.route} key={i} />
                ))}
                <StaticPlate plate={rest.source} />
                {rest.destinations.map((item: Plate, i: number) => (
                    <StaticPlate plate={item} index={i} key={i} />
                ))}
            </svg>
            <div className="distribution-live" ref={live} aria-hidden="true">
                <svg viewBox="0 0 640 390" />
            </div>
        </div>
    )
}

export function PublicDistribution() {
    return (
        <section className="home-distribution" aria-labelledby="distribution-title">
            <div className="home-distribution-copy">
                <h2 id="distribution-title">
                    Write once.
                    <br />
                    Make each destination yours.
                </h2>
                <p>
                    Start with one post. Adapt the text, media and schedule for each network, while
                    keeping your source in one place.
                </p>
            </div>
            <DistributionIllustration />
        </section>
    )
}
