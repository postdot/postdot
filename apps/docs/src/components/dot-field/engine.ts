/**
 * Dot-field engine for public illustrations. A scene names DOM nodes and the routes between them;
 * the engine draws a dot grid behind the nodes, a dotted line per route, a pulse that travels each
 * route on its own schedule and a ripple at the destination. Everything is decorative: callers
 * mark the container `aria-hidden` or give it a text alternative.
 */

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface FieldRoute {
    /** `data-field-node` value of the source node. */
    readonly from: string
    readonly to: string
    readonly fromEdge?: Edge
    readonly toEdge?: Edge
    /** Seconds into the cycle when the pulse leaves. */
    readonly at: number
    /** Seconds the pulse takes to arrive. */
    readonly travel: number
    /** Palette accent used for the arrival ripple; omit for no ripple. */
    readonly ripple?: string
}

export interface FieldScene {
    readonly cycle: number
    readonly routes: readonly FieldRoute[]
}

export interface FieldPalette {
    readonly ink: string
    readonly route: string
    readonly accents: Readonly<Record<string, string>>
}

interface Point {
    x: number
    y: number
}

interface GridDot extends Point {
    /** Index of the nearest rippling route. */
    target: number
    distance: number
}

interface RouteDot extends Point {
    route: number
    /** 0 at the source, 1 at the destination. */
    along: number
}

const spacing = 14
const routeGap = 7
const routeClearance = 8
const rippleSeconds = 1.6
const rippleRadius = 64
const arrivedSeconds = 1.4

const directions: Record<Edge, Point> = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
}

export interface FieldOptions {
    /** `none` draws the routes only, without the dot grid. */
    readonly grid?: 'field' | 'none'
    readonly container: HTMLElement
    readonly canvas: HTMLCanvasElement
    readonly scene: FieldScene
    readonly readPalette: () => FieldPalette
}

/** Start the field. Returns the cleanup. */
export function runField({
    container,
    canvas,
    scene,
    readPalette,
    grid: gridMode = 'field',
}: FieldOptions) {
    const context = canvas.getContext('2d')
    if (!context) return () => undefined

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointer = { x: -1000, y: -1000, tx: -1000, ty: -1000 }
    const arrived = new Map<Element, boolean>()
    let palette = readPalette()
    let grid: GridDot[] = []
    let routeDots: RouteDot[] = []
    let arrivals: Point[] = []
    let width = 0
    let height = 0
    let frame = 0
    let running = false
    let visible = true

    function layout() {
        const bounds = container.getBoundingClientRect()
        width = bounds.width
        height = bounds.height
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        context?.setTransform(ratio, 0, 0, ratio, 0, 0)

        const rectangles = new Map<string, DOMRect>()
        container.querySelectorAll<HTMLElement>('[data-field-node]').forEach(element => {
            const id = element.dataset.fieldNode
            if (id) rectangles.set(id, element.getBoundingClientRect())
        })
        const anchor = (id: string, edge: Edge): Point | undefined => {
            const box = rectangles.get(id)
            if (!box) return undefined
            const left = box.left - bounds.left
            const top = box.top - bounds.top
            if (edge === 'left') return { x: left, y: top + box.height / 2 }
            if (edge === 'right') return { x: left + box.width, y: top + box.height / 2 }
            if (edge === 'top') return { x: left + box.width / 2, y: top }
            return { x: left + box.width / 2, y: top + box.height }
        }

        routeDots = []
        arrivals = []
        scene.routes.forEach((route, index) => {
            const fromEdge = route.fromEdge ?? 'right'
            const toEdge = route.toEdge ?? 'left'
            const from = anchor(route.from, fromEdge)
            const to = anchor(route.to, toEdge)
            arrivals[index] = to ?? { x: -1000, y: -1000 }
            if (!from || !to) return
            routeDots.push(...dotsAlong(curve(from, to, fromEdge, toEdge), index))
        })

        const covered = [...rectangles.values()].map(box => ({
            left: box.left - bounds.left - 2,
            right: box.right - bounds.left + 2,
            top: box.top - bounds.top - 2,
            bottom: box.bottom - bounds.top + 2,
        }))
        grid = []
        for (let y = spacing / 2; gridMode === 'field' && y < height; y += spacing) {
            for (let x = spacing / 2; x < width; x += spacing) {
                if (covered.some(c => x > c.left && x < c.right && y > c.top && y < c.bottom)) {
                    continue
                }
                if (routeDots.some(dot => Math.hypot(dot.x - x, dot.y - y) < routeClearance)) {
                    continue
                }
                grid.push(nearestArrival(x, y, arrivals))
            }
        }
        palette = readPalette()
        draw(performance.now() / 1000)
        container.dataset.fieldReady = 'true'
    }

    function phase(seconds: number, route: FieldRoute) {
        return (((seconds - route.at) % scene.cycle) + scene.cycle) % scene.cycle
    }

    function draw(seconds: number) {
        const ctx = context
        if (!ctx) return
        const animated = !reduceMotion.matches
        pointer.x += (pointer.tx - pointer.x) * 0.12
        pointer.y += (pointer.ty - pointer.y) * 0.12
        ctx.clearRect(0, 0, width, height)

        for (const dot of grid) {
            let alpha = 0.2
            let radius = 1.1
            let color = palette.ink
            let x = dot.x
            let y = dot.y
            if (animated) alpha += 0.07 * Math.sin(seconds * 0.7 + dot.x * 0.016 + dot.y * 0.011)

            const route = scene.routes[dot.target]
            if (animated && route?.ripple && dot.distance < rippleRadius + 14) {
                const since = phase(seconds, route) - route.travel
                if (since > 0 && since < rippleSeconds) {
                    const progress = since / rippleSeconds
                    const ripple =
                        Math.exp(-(((dot.distance - progress * rippleRadius) / 7) ** 2)) *
                        (1 - progress)
                    const accent = palette.accents[route.ripple]
                    if (ripple > 0.04 && accent) {
                        color = accent
                        alpha = Math.min(1, Math.max(alpha, 0.9 * ripple))
                        radius = Math.max(radius, 1 + 1.6 * ripple)
                    }
                }
            }
            if (animated) {
                const dx = x - pointer.x
                const dy = y - pointer.y
                const distance = Math.hypot(dx, dy)
                if (distance < 100) {
                    const pull = (1 - distance / 100) ** 2
                    alpha = Math.min(1, alpha + 0.4 * pull)
                    radius += 0.8 * pull
                    if (distance > 0.1) {
                        x += (dx / distance) * 5 * pull
                        y += (dy / distance) * 5 * pull
                    }
                }
            }
            paint(ctx, x, y, radius, color, alpha)
        }

        for (const dot of routeDots) {
            const route = scene.routes[dot.route]
            let alpha = 0.55
            let radius = 1.3
            if (animated && route) {
                const head = phase(seconds, route) / route.travel
                const pulse = Math.exp(-(((dot.along - head) / 0.1) ** 2))
                alpha += 0.45 * pulse
                radius += 1.6 * pulse
            }
            paint(ctx, dot.x, dot.y, radius, palette.route, alpha)
        }
        ctx.globalAlpha = 1

        if (animated) markArrivals(seconds)
    }

    function markArrivals(seconds: number) {
        scene.routes.forEach(route => {
            const element = container.querySelector(`[data-field-node="${route.to}"]`)
            if (!element) return
            const since = phase(seconds, route) - route.travel
            const active = since > 0 && since < arrivedSeconds
            if (arrived.get(element) === active) return
            arrived.set(element, active)
            if (active) element.setAttribute('data-arrived', '')
            else element.removeAttribute('data-arrived')
        })
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

    function onMove(event: PointerEvent) {
        const bounds = container.getBoundingClientRect()
        pointer.tx = event.clientX - bounds.left
        pointer.ty = event.clientY - bounds.top
    }
    function onLeave() {
        pointer.tx = -1000
        pointer.ty = -1000
    }
    function onTheme() {
        palette = readPalette()
        if (!running) draw(performance.now() / 1000)
    }

    const resize = new ResizeObserver(layout)
    resize.observe(container)
    const intersection = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting)
        sync()
    })
    intersection.observe(container)
    const theme = new MutationObserver(onTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', sync)
    reduceMotion.addEventListener('change', sync)
    layout()
    sync()

    return () => {
        running = false
        cancelAnimationFrame(frame)
        resize.disconnect()
        intersection.disconnect()
        theme.disconnect()
        container.removeEventListener('pointermove', onMove)
        container.removeEventListener('pointerleave', onLeave)
        document.removeEventListener('visibilitychange', sync)
        reduceMotion.removeEventListener('change', sync)
        container
            .querySelectorAll('[data-arrived]')
            .forEach(el => el.removeAttribute('data-arrived'))
        delete container.dataset.fieldReady
    }
}

function paint(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    alpha: number
) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
}

function curve(from: Point, to: Point, fromEdge: Edge, toEdge: Edge, steps = 80): Point[] {
    const reach = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.5)
    const a = directions[fromEdge]
    const b = directions[toEdge]
    const c1 = { x: from.x + a.x * reach, y: from.y + a.y * reach }
    const c2 = { x: to.x + b.x * reach, y: to.y + b.y * reach }
    const points: Point[] = []
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps
        const u = 1 - t
        points.push({
            x: u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x,
            y: u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y,
        })
    }
    return points
}

function dotsAlong(points: Point[], route: number): RouteDot[] {
    const segments: { from: Point; to: Point; start: number; length: number }[] = []
    let total = 0
    points.forEach((to, index) => {
        const from = points[index - 1]
        if (!from) return
        const length = Math.hypot(to.x - from.x, to.y - from.y)
        segments.push({ from, to, start: total, length })
        total += length
    })
    const dots: RouteDot[] = []
    for (const { from, to, start, length } of segments) {
        const first = Math.ceil(start / routeGap) * routeGap
        for (let distance = first; distance < start + length; distance += routeGap) {
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

function nearestArrival(x: number, y: number, arrivals: Point[]): GridDot {
    let target = -1
    let distance = Infinity
    arrivals.forEach((arrival, index) => {
        const d = Math.hypot(arrival.x - x, arrival.y - y)
        if (d < distance) {
            distance = d
            target = index
        }
    })
    return { x, y, target, distance }
}
