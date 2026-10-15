import { brands } from './brands.js'
import { sceneAt, spreadAt } from './scene.js'
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
        const image = mk('path', { class: 'image' }, body.g)
        const landscape = mk('path', { class: 'accent' }, body.g)
        const lines = Array.from({ length: 3 }, () => mk('path', { class: 'rule' }, body.g))
        return { body, image, landscape, lines }
    }
    const source = makePlate()
    const targets = [0, 1, 2].map(i => {
        const route = mk('path', { class: 'connector' }, routes)
        const pulse = mk('circle', { r: 2.2, class: 'pulse' }, routes)
        const plate = makePlate()
        const logo = mk(
            'svg',
            {
                width: 17,
                height: 17,
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
    let elapsed = 0
    function draw(spread, clock) {
        const pose = sceneAt(spread)
        drawPlate(source, pose.source)
        targets.forEach((nodes, i) => {
            const item = pose.destinations[i]
            drawPlate(nodes, item)
            nodes.logo.setAttribute('x', item.badge[0] - 8.5)
            nodes.logo.setAttribute('y', item.badge[1] - 8.5)
            nodes.route.setAttribute('d', item.route)
            const phase = (clock / 1800 - i * 0.16) % 1
            const traveling = phase > 0.12 && phase < 0.86 && !reducedMotion()
            nodes.pulse.style.opacity = traveling ? '1' : '0'
            if (traveling) {
                const p = nodes.route.getPointAtLength(
                    (nodes.route.getTotalLength() * (phase - 0.12)) / 0.74
                )
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
