import { test, expect } from 'bun:test'

// The production scene is browser-independent; no duplicated test geometry.
import { sceneAt, spreadAt } from '../../public/illustrations/scene.js'

test('animated routes stay attached throughout an entire opening and closing cycle', () => {
    const portYs = new Set()
    for (let ms = 0; ms <= 6400; ms += 40) {
        const scene = sceneAt(spreadAt(ms))
        for (const item of scene.destinations) {
            const numbers = item.route.match(/-?\d+(?:\.\d+)?/g).map(Number)
            const end = numbers.slice(-2)
            expect(Math.abs(end[0]! - item.port[0])).toBeLessThan(0.02)
            expect(Math.abs(end[1]! - item.port[1])).toBeLessThan(0.02)
            expect(item.shape.sil).not.toContain('NaN')
            expect(item.shape.sil).not.toContain('Infinity')
        }
        portYs.add(scene.destinations[2]!.port[1].toFixed(1))
        expect(scene.destinations[0]!.z).toBeLessThan(scene.destinations[1]!.z)
        expect(scene.destinations[1]!.z).toBeLessThan(scene.destinations[2]!.z)
    }
    expect(portYs.size).toBeGreaterThan(20)
})
