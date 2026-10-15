import { test, expect } from 'bun:test'

// The production scene is browser-independent; no duplicated test geometry.
import { sceneAt, spreadAt, transferAt } from '../../public/illustrations/scene.js'

test('routes stay attached and stack order remains stable throughout the transfer cycle', () => {
    const portYs = new Set()
    for (let ms = 0; ms <= 7200; ms += 40) {
        const scene = sceneAt(spreadAt(ms))
        for (const item of scene.destinations) {
            const numbers = item.route.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
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
    expect(portYs.size).toBe(1)
})

test('destination content appears after arrival, then resets for the next cycle', () => {
    for (let index = 0; index < 3; index++) {
        const departure = 900 + index * 350
        expect(transferAt(departure + 500, index).content).toBe(0)
        expect(transferAt(departure + 500, index).progress).toBeGreaterThan(0)
        expect(transferAt(departure + 2000, index).content).toBe(1)
        expect(transferAt(7199, index).content).toBeLessThan(0.01)
    }
})
