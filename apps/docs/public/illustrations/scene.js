import { HL } from './vendor/hairline/kernel.js'

const { Cam, fit, proj, facing, rings, prism, poly, open } = HL
const camera = Cam(45, 0.5, 1.8)
fit(
    camera,
    [
        [-115, 65, 52],
        [-7, 139, 55],
        [25, -75, 10],
        [160, -1, 115],
    ],
    320,
    195
)
const project = proj(camera)
const front = facing(camera)
const source = { x: -115, y: 65, z: 52, width: 108, depth: 74 }
const bases = [10, 52, 94]

function plate(spec) {
    const { x, y, z, width, depth } = spec
    const [ring, inner] = rings(x, y, x + width, y + depth, 2, 1)
    const shape = prism(project, front, ring, inner, z, z + 3)
    const point = (u, v) => project(x + u, y + v, z + 3)
    const lines = [44, 53, 62].map((v, i) => open([point(12, v), point([94, 83, 68][i], v)]))
    const image = poly([point(12, 10), point(96, 10), point(96, 35), point(12, 35)])
    const horizon = open(
        [
            [17, 31],
            [34, 18],
            [49, 30],
            [63, 22],
            [78, 31],
        ].map(([u, v]) => point(u, v))
    )
    const sun = poly(
        Array.from({ length: 20 }, (_, i) =>
            point(82 + 3 * Math.cos((i * Math.PI) / 10), 17 + 3 * Math.sin((i * Math.PI) / 10))
        )
    )
    const landscape = horizon + ' ' + sun

    return {
        shape,
        lines,
        image,
        landscape,
        port: project(x, y + depth / 2, z + 1.5),
        badge: project(x + width + 15, y + depth / 2, z + 2),
    }
}

/** One pose owns solids, content, brand positions and connector endpoints. */
export function sceneAt(spread) {
    // Layout stays at rest: only content and active edges participate in the transfer.
    void spread
    const origin = plate(source)
    const sourcePort = project(source.x + source.width, source.y + source.depth / 2, source.z + 1.5)
    const junction = [(sourcePort[0] + project(25, -38, 53.5)[0]) / 2, sourcePort[1]]
    const destinations = bases.map((base, i) => {
        const z = base
        const item = plate({ x: 25, y: -75, z, width: 108, depth: 74 })
        return {
            ...item,
            z,
            index: i,
            schedule: {
                x: item.badge[0] - 40,
                y: item.badge[1] + 20,
                label: ['09:00', '12:30', '18:00'][i],
            },
            route: `M${sourcePort.join(',')} L${junction.join(',')} C${junction[0] + 26},${junction[1]} ${item.port[0] - 26},${item.port[1]} ${item.port.join(',')}`,

            start: sourcePort,
        }
    })
    return { source: origin, sourcePort, destinations }
}

export function spreadAt(time) {
    return (time % 7600) / 7600
}

/** A transfer arrives before the destination draws its content. */
export function transferAt(time, index) {
    const phase = time % 7600
    const departure = 800 + index * 600
    const progress = Math.max(0, Math.min(1, (phase - departure) / 1000))
    const content = HL.EASE_LIFT(Math.max(0, Math.min(1, (phase - departure - 1000) / 700)))
    const reset = phase > 6500 ? 1 - HL.EASE_LIFT(Math.min(1, (phase - 6500) / 600)) : 1
    return {
        progress,
        content: content * reset,
        drawn: content,
        active: phase >= departure + 1000 && phase < departure + 1500,
    }
}
