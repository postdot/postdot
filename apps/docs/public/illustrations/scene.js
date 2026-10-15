import { HL } from './vendor/hairline/kernel.js'

const { Cam, fit, proj, facing, rings, prism, poly, open } = HL
const camera = Cam(45, 0.5, 1.8)
fit(
    camera,
    [
        [-180, -40, 0],
        [-72, 34, 40],
        [25, -40, 146],
        [165, 34, 0],
    ],
    320,
    195
)
const project = proj(camera)
const front = facing(camera)
const source = { x: -180, y: -40, z: 44, width: 108, depth: 74 }
const bases = [10, 52, 94]

function plate(spec) {
    const { x, y, z, width, depth } = spec
    const [ring, inner] = rings(x, y, x + width, y + depth, 2, 1)
    const shape = prism(project, front, ring, inner, z, z + 3)
    const point = (u, v) => project(x + u, y + v, z + 3)
    const lines = [44, 53, 62].map((v, i) => open([point(12, v), point([94, 83, 68][i], v)]))
    const image = poly([point(12, 10), point(96, 10), point(96, 35), point(12, 35)])
    const landscape = open(
        [
            [19, 29],
            [36, 18],
            [51, 27],
            [73, 15],
            [88, 28],
        ].map(([u, v]) => point(u, v))
    )
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
    const value = Math.max(0, Math.min(1, spread))
    const origin = plate(source)
    const sourcePort = project(source.x + source.width, source.y + source.depth / 2, source.z + 1.5)
    const junction = project(-23, -3, source.z + 1.5)
    const destinations = bases.map((base, i) => {
        const z = base + (i - 1) * 18 * value
        const item = plate({ x: 25, y: -40, z, width: 108, depth: 74 })
        return {
            ...item,
            z,
            index: i,
            route: open([sourcePort, junction, item.port]),
            start: sourcePort,
        }
    })
    return { source: origin, sourcePort, destinations }
}

export function spreadAt(time) {
    const phase = (time % 6400) / 6400
    if (phase < 0.12) return 0
    if (phase < 0.4) return HL.EASE_LIFT((phase - 0.12) / 0.28)
    if (phase < 0.72) return 1
    return 1 - HL.EASE_LIFT((phase - 0.72) / 0.28)
}
