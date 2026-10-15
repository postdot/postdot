import { brands } from './brands.js'
import { sceneAt, spreadAt, transferAt } from './scene.js'
import { HL } from './vendor/hairline/kernel.js'

const { mk, solid, put, register, reducedMotion } = HL
export function mountFigure(stage) {
    const svg = stage.querySelector('svg')
    svg.replaceChildren()
    const routes = mk('g', {}, svg)
    const root = mk('g', {}, svg)
    const makePlate = () => {
        const body = solid(root)
        body.sil.setAttribute('class', 'sil')
        body.cr.setAttribute('class', 'crease')
        const content = mk('g', {}, body.g)
        const image = mk('path', { class: 'image' }, content)
        const landscape = mk('path', { class: 'accent' }, content)
        const lines = Array.from({ length: 3 }, () => mk('path', { class: 'rule' }, content))
        return { body, content, image, landscape, lines }
    }
    const source = makePlate()
    const targets = [0, 1, 2].map(i => {
        const route = mk('path', { class: 'connector' }, routes)
        const pulse = mk('circle', { r: 2.2, class: 'pulse' }, routes)
        const plate = makePlate()
        const logo = mk(
            'svg',
            {
                width: 24,
                height: 24,
                fill: 'currentColor',
                viewBox: `0 0 ${brands[i].width} ${brands[i].height}`,
                'aria-hidden': 'true',
            },
            plate.body.g
        )
        logo.innerHTML = brands[i].body
        return { ...plate, route, pulse, logo }
    })
    function drawPlate(nodes, pose) {
        put(nodes.body, pose.shape)
        nodes.image.setAttribute('d', pose.image)
        nodes.landscape.setAttribute('d', pose.landscape)
        nodes.lines.forEach((line, i) => line.setAttribute('d', pose.lines[i]))
    }
    // Geometry stays fixed during this sequence; build and measure it once.
    const pose = sceneAt(1)
    drawPlate(source, pose.source)
    targets.forEach((nodes, i) => {
        const item = pose.destinations[i]
        drawPlate(nodes, item)
        nodes.logo.setAttribute('x', item.badge[0] - 12)
        nodes.logo.setAttribute('y', item.badge[1] - 12)
        nodes.route.setAttribute('d', item.route)
        nodes.routeLength = nodes.route.getTotalLength()
        nodes.lines.forEach(line => {
            line.setAttribute('pathLength', '1')
            line.style.strokeDasharray = '1'
        })
    })
    let elapsed = 0
    function draw(spread, clock) {
        targets.forEach((nodes, i) => {
            const transfer = transferAt(clock, i)
            const complete = reducedMotion() ? 1 : transfer.content
            nodes.content.style.opacity = String(complete)
            nodes.lines.forEach((line, j) => {
                line.style.strokeDashoffset = String(
                    1 -
                        Math.max(
                            0,
                            Math.min(1, (reducedMotion() ? 1 : transfer.drawn) * 1.5 - j * 0.16)
                        )
                )
            })
            nodes.body.sil.classList.toggle('active', !reducedMotion() && transfer.active)
            const traveling = transfer.progress > 0 && transfer.progress < 1 && !reducedMotion()
            nodes.pulse.style.opacity = traveling ? '1' : '0'
            if (traveling) {
                const p = nodes.route.getPointAtLength(nodes.routeLength * transfer.progress)
                nodes.pulse.setAttribute('cx', p.x)
                nodes.pulse.setAttribute('cy', p.y)
            }
        })
        stage.dataset.spread = spread.toFixed(4)
    }
    const board = register(stage, dt => {
        if (document.hidden) return false
        const reduced = reducedMotion()
        if (!reduced) elapsed += dt * 1000
        draw(reduced ? 1 : spreadAt(elapsed), elapsed)
        return !reduced
    })
    const wake = () => board.wake()
    document.addEventListener('visibilitychange', wake)
    const destroy = () => {
        board.unregister()
        document.removeEventListener('visibilitychange', wake)
        window.removeEventListener('pagehide', destroy)
        svg.replaceChildren()
    }
    return destroy
}
