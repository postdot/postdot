import blueskyIcon from '@iconify-icons/logos/bluesky'
import instagramIcon from '@iconify-icons/logos/instagram-icon'
import linkedinIcon from '@iconify-icons/logos/linkedin-icon'
import xIcon from '@iconify-icons/logos/x'
import { Icon } from '@iconify/react'
import { useEffect, useRef } from 'react'

import * as m from '@/paraglide/messages.js'

const destinations = [
    { name: 'X', icon: xIcon, state: 'published' },
    { name: 'LinkedIn', icon: linkedinIcon, state: 'queued' },
    { name: 'Instagram', icon: instagramIcon, state: 'review' },
    { name: 'Bluesky', icon: blueskyIcon, state: 'draft' },
] as const

type DestinationState = (typeof destinations)[number]['state']

const stateLabel: Record<DestinationState, () => string> = {
    published: () => m.publication_state_published(),
    queued: () => m.publication_state_queued(),
    review: () => m.publication_state_needs_review(),
    draft: () => m.publication_state_draft(),
}

const stateColor: Record<DestinationState, string> = {
    published: 'text-state-published',
    queued: 'text-state-queued',
    review: 'text-state-attention',
    draft: 'text-state-draft',
}

/** CSS custom property that carries each state's colour into the canvas. */
const stateToken: Record<DestinationState, string> = {
    published: '--state-published',
    queued: '--state-queued',
    review: '--state-attention',
    draft: '--state-draft',
}

/** Static film grain; overlay blending keeps the average tone of the canvas unchanged. */
const grainImage = `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>"
)}")`

/**
 * Decorative stage for the authentication pages: the product's core relationship (one source,
 * several accountable destinations) drawn as a dot field. Dots along each route light up in turn
 * and the arrival ripples in the destination's own state colour. Everything is hidden from
 * assistive technology; the form is the page.
 */
export function AuthDispatchStage() {
    const stageRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const sourceRef = useRef<HTMLDivElement>(null)
    const destinationRefs = useRef<(HTMLLIElement | null)[]>([])

    useEffect(() => {
        const stage = stageRef.current
        const canvas = canvasRef.current
        const source = sourceRef.current
        if (!stage || !canvas || !source) return
        const context = canvas.getContext('2d')
        if (!context) return
        return runDotField({
            stage,
            canvas,
            context,
            source,
            destinations: () =>
                destinationRefs.current.filter((item): item is HTMLLIElement => item !== null),
        })
    }, [])

    return (
        <div
            ref={stageRef}
            aria-hidden="true"
            className="relative isolate hidden overflow-hidden bg-surface-canvas lg:block">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 -z-10 size-full [mask-image:radial-gradient(ellipse_75%_70%_at_50%_45%,black_40%,transparent_100%)]"
            />
            <div
                className="pointer-events-none absolute inset-0 -z-10 opacity-25 mix-blend-overlay"
                style={{ backgroundImage: grainImage }}
            />

            <div className="flex h-full min-h-svh flex-col justify-between p-10 xl:p-16">
                <div className="flex flex-1 items-center">
                    <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-12 xl:gap-28">
                        <div
                            ref={sourceRef}
                            className="w-44 shrink-0 bg-surface-raised px-4 py-4 xl:w-52 rounded-[3px]">
                            <p className="text-xs text-muted-foreground">
                                {m.auth_board_source_label()}
                            </p>
                            <p className="mt-1 text-base leading-snug font-semibold">
                                {m.auth_board_source_title()}
                            </p>
                        </div>

                        <ul className="flex w-48 shrink-0 flex-col gap-3.5 xl:w-56">
                            {destinations.map((destination, index) => (
                                <li
                                    key={destination.name}
                                    ref={element => {
                                        destinationRefs.current[index] = element
                                    }}
                                    className="flex items-center gap-3 bg-surface-raised px-3 py-2.5 rounded-[3px]">
                                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-white">
                                        <Icon icon={destination.icon} className="size-5" />
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="text-sm leading-tight font-medium">
                                            {destination.name}
                                        </span>
                                        <span
                                            className={`text-xs leading-tight font-medium ${stateColor[destination.state]}`}>
                                            {stateLabel[destination.state]()}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="max-w-md">
                    <p className="text-4xl leading-[1.08] tracking-tight xl:text-5xl">
                        <span className="block font-semibold">
                            {m.auth_stage_headline_source()}
                        </span>
                        <span className="block font-light text-muted-foreground">
                            {m.auth_stage_headline_destinations()}
                        </span>
                    </p>
                    <p className="mt-5 text-sm leading-6 text-muted-foreground">
                        {m.auth_board_caption()}
                    </p>
                </div>
            </div>
        </div>
    )
}

interface DotFieldOptions {
    readonly stage: HTMLElement
    readonly canvas: HTMLCanvasElement
    readonly context: CanvasRenderingContext2D
    readonly source: HTMLElement
    readonly destinations: () => HTMLElement[]
}

interface Point {
    x: number
    y: number
}

interface Dot {
    x: number
    y: number
    /** Nearest destination, whose arrival ripple this dot belongs to. */
    target: number
    /** Distance to that destination's anchor. */
    toTarget: number
}

/** One dot of a route's dotted line. */
interface RouteDot {
    x: number
    y: number
    route: number
    /** Position along the route, 0 at the source and 1 at the destination. */
    along: number
}

interface Palette {
    readonly ink: string
    readonly route: string
    readonly states: readonly string[]
}

const spacing = 15
const routeDotGap = 7
const routeClearance = 8
const cycleSeconds = 6.4
const stagger = 0.42
const travelSeconds = 2.6
const rippleSeconds = 1.7
const rippleRadius = 74

/**
 * Draw and animate the dot field. Returns the cleanup. With reduced motion the field is drawn once
 * with the routes lit and nothing moves.
 */
function runDotField({ stage, canvas, context, source, destinations }: DotFieldOptions) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let dots: Dot[] = []
    let routeDots: RouteDot[] = []
    let anchors: Point[] = []
    let palette = readPalette(stage)
    let width = 0
    let height = 0
    let ratio = 1
    let frame = 0
    let running = false
    let visible = true
    const pointer = { x: -1000, y: -1000, tx: -1000, ty: -1000 }

    function layout() {
        const bounds = canvas.getBoundingClientRect()
        width = bounds.width
        height = bounds.height
        ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        context.setTransform(ratio, 0, 0, ratio, 0, 0)

        const from = anchorOf(source, bounds, 'right')
        anchors = destinations().map(item => anchorOf(item, bounds, 'left'))
        const routes = anchors.map(to => sampleRoute(from, to))
        routeDots = routes.flatMap((points, route) => dotsAlong(points, route))

        dots = []
        for (let y = spacing / 2; y < height; y += spacing) {
            for (let x = spacing / 2; x < width; x += spacing) {
                if (routeDots.some(dot => Math.hypot(dot.x - x, dot.y - y) < routeClearance))
                    continue
                dots.push(classify(x, y, anchors))
            }
        }
        palette = readPalette(stage)
        draw(performance.now() / 1000)
    }

    function draw(seconds: number) {
        const animated = !reduceMotion.matches
        pointer.x += (pointer.tx - pointer.x) * 0.12
        pointer.y += (pointer.ty - pointer.y) * 0.12

        context.clearRect(0, 0, width, height)
        for (const dot of dots) {
            let alpha = 0.2
            let radius = 1.1
            let color = palette.ink
            let x = dot.x
            let y = dot.y

            if (animated) {
                alpha += 0.07 * Math.sin(seconds * 0.7 + dot.x * 0.016 + dot.y * 0.011)
            }

            if (animated && dot.toTarget < rippleRadius + 14) {
                const sinceArrival = routePhase(seconds, dot.target) - travelSeconds
                if (sinceArrival > 0 && sinceArrival < rippleSeconds) {
                    const progress = sinceArrival / rippleSeconds
                    const ripple =
                        Math.exp(-(((dot.toTarget - progress * rippleRadius) / 7) ** 2)) *
                        (1 - progress)
                    if (ripple > 0.04) {
                        color = palette.states[dot.target] ?? color
                        alpha = Math.min(1, Math.max(alpha, 0.9 * ripple))
                        radius = Math.max(radius, 1 + 1.6 * ripple)
                    }
                }
            }

            if (animated) {
                const dx = dot.x - pointer.x
                const dy = dot.y - pointer.y
                const distance = Math.hypot(dx, dy)
                if (distance < 110) {
                    const pull = (1 - distance / 110) ** 2
                    alpha = Math.min(1, alpha + 0.4 * pull)
                    radius += 0.8 * pull
                    if (distance > 0.1) {
                        x += (dx / distance) * 5 * pull
                        y += (dy / distance) * 5 * pull
                    }
                }
            }

            paint(x, y, radius, color, alpha)
        }

        for (const dot of routeDots) {
            let alpha = 0.55
            let radius = 1.3
            if (animated) {
                const head = routePhase(seconds, dot.route) / travelSeconds
                const pulse = Math.exp(-(((dot.along - head) / 0.1) ** 2))
                alpha += 0.45 * pulse
                radius += 1.6 * pulse
            }
            paint(dot.x, dot.y, radius, palette.route, alpha)
        }
        context.globalAlpha = 1
    }

    function paint(x: number, y: number, radius: number, color: string, alpha: number) {
        context.globalAlpha = Math.max(0, Math.min(1, alpha))
        context.fillStyle = color
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
    }

    function tick(now: number) {
        draw(now / 1000)
        frame = running ? requestAnimationFrame(tick) : 0
    }

    function sync() {
        const shouldRun = visible && !document.hidden && !reduceMotion.matches
        if (shouldRun && !running) {
            running = true
            frame = requestAnimationFrame(tick)
        } else if (!shouldRun && running) {
            running = false
            cancelAnimationFrame(frame)
            draw(performance.now() / 1000)
        }
    }

    function onPointerMove(event: PointerEvent) {
        const bounds = canvas.getBoundingClientRect()
        pointer.tx = event.clientX - bounds.left
        pointer.ty = event.clientY - bounds.top
    }
    function onPointerLeave() {
        pointer.tx = -1000
        pointer.ty = -1000
    }
    function onTheme() {
        palette = readPalette(stage)
        if (!running) draw(performance.now() / 1000)
    }

    const resize = new ResizeObserver(layout)
    resize.observe(stage)
    const intersection = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting)
        sync()
    })
    intersection.observe(stage)
    const theme = new MutationObserver(onTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerleave', onPointerLeave)
    document.addEventListener('visibilitychange', sync)
    reduceMotion.addEventListener('change', sync)
    colorScheme.addEventListener('change', onTheme)
    layout()
    sync()

    return () => {
        running = false
        cancelAnimationFrame(frame)
        resize.disconnect()
        intersection.disconnect()
        theme.disconnect()
        stage.removeEventListener('pointermove', onPointerMove)
        stage.removeEventListener('pointerleave', onPointerLeave)
        document.removeEventListener('visibilitychange', sync)
        reduceMotion.removeEventListener('change', sync)
        colorScheme.removeEventListener('change', onTheme)
    }
}

/** Seconds into this route's current cycle; routes start one after another. */
function routePhase(seconds: number, route: number) {
    return (((seconds - route * stagger) % cycleSeconds) + cycleSeconds) % cycleSeconds
}

function anchorOf(element: HTMLElement, canvas: DOMRect, edge: 'left' | 'right'): Point {
    const box = element.getBoundingClientRect()
    return {
        x: (edge === 'left' ? box.left : box.right) - canvas.left,
        y: box.top + box.height / 2 - canvas.top,
    }
}

function sampleRoute(from: Point, to: Point, steps = 72): Point[] {
    const reach = (to.x - from.x) * 0.55
    const points: Point[] = []
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps
        const u = 1 - t
        points.push({
            x:
                u ** 3 * from.x +
                3 * u * u * t * (from.x + reach) +
                3 * u * t * t * (to.x - reach) +
                t ** 3 * to.x,
            y: u ** 3 * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t ** 3 * to.y,
        })
    }
    return points
}

/** Evenly spaced dots along a sampled route. */
function dotsAlong(points: Point[], route: number): RouteDot[] {
    const segments: { from: Point; to: Point; start: number }[] = []
    let total = 0
    points.forEach((to, index) => {
        const from = points[index - 1]
        if (!from) return
        segments.push({ from, to, start: total })
        total += Math.hypot(to.x - from.x, to.y - from.y)
    })

    const dots: RouteDot[] = []
    for (const { from, to, start } of segments) {
        const length = Math.hypot(to.x - from.x, to.y - from.y)
        const first = Math.ceil(start / routeDotGap) * routeDotGap
        for (let distance = first; distance < start + length; distance += routeDotGap) {
            const t = (distance - start) / length
            dots.push({
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t,
                route,
                along: distance / total,
            })
        }
    }
    return dots
}

function classify(x: number, y: number, anchors: Point[]): Dot {
    let target = -1
    let toTarget = Infinity
    anchors.forEach((anchor, index) => {
        const distance = Math.hypot(anchor.x - x, anchor.y - y)
        if (distance < toTarget) {
            toTarget = distance
            target = index
        }
    })
    return { x, y, target, toTarget }
}

function readPalette(element: HTMLElement): Palette {
    const style = getComputedStyle(element)
    const read = (token: string, fallback: string) =>
        style.getPropertyValue(token).trim() || fallback
    return {
        ink: read('--foreground', '#888888'),
        route: read('--primary', '#2457d6'),
        states: destinations.map(destination => read(stateToken[destination.state], '#888888')),
    }
}
