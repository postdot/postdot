import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const surfaceTokens = [
    'surface-background',
    'surface-canvas',
    'surface-inset',
    'surface-field',
    'surface-control',
    'surface-raised',
    'surface-overlay',
    'surface-sidebar',
    'surface-selected',
] as const

const surfaceStatePairs = [
    ['surface-control', 'surface-control-hover'],
    ['surface-sidebar', 'surface-sidebar-hover'],
] as const

const minSurfaceLightnessDelta = 0.008
const minTextContrastRatio = 4.5

const css = readFileSync(join(import.meta.dir, 'globals.css'), 'utf8')
const themes = {
    light: extractBlock(css, ':root'),
    dark: extractBlock(css, '.dark'),
} as const

describe('surface token contract', () => {
    for (const [themeName, block] of Object.entries(themes)) {
        const tokens = parseTokens(block, [
            ...surfaceTokens,
            ...surfaceStatePairs.flat(),
            'foreground',
            'muted-foreground',
            'primary',
            'primary-foreground',
            'secondary-foreground',
        ])

        test(`${themeName} surfaces remain perceptually distinct`, () => {
            const adjacentRoles = [
                ['surface-canvas', 'surface-background'],
                ['surface-background', 'surface-raised'],
                ['surface-background', 'surface-selected'],
                ['surface-inset', 'surface-selected'],
                ['surface-raised', 'surface-control'],
            ] as const

            for (const [parent, child] of adjacentRoles) {
                const delta = Math.abs(
                    getToken(tokens, parent).lightness - getToken(tokens, child).lightness
                )
                const minimum = minSurfaceLightnessDelta
                expect(
                    delta,
                    `${themeName}: ${parent} and ${child} are too close`
                ).toBeGreaterThanOrEqual(minimum)
            }
        })

        test(`${themeName} state surfaces change their base role`, () => {
            for (const [baseToken, stateToken] of surfaceStatePairs) {
                const delta = Math.abs(
                    getToken(tokens, baseToken).lightness - getToken(tokens, stateToken).lightness
                )

                expect(
                    delta,
                    `${themeName}: ${stateToken} must differ from ${baseToken}`
                ).toBeGreaterThanOrEqual(minSurfaceLightnessDelta)
            }
        })

        test(`${themeName} text keeps a readable contrast`, () => {
            for (const surfaceToken of surfaceTokens) {
                expect(
                    contrastRatio(getToken(tokens, 'foreground'), getToken(tokens, surfaceToken)),
                    `${themeName}: foreground on ${surfaceToken}`
                ).toBeGreaterThanOrEqual(minTextContrastRatio)
            }

            for (const surfaceToken of surfaceTokens) {
                expect(
                    contrastRatio(
                        getToken(tokens, 'muted-foreground'),
                        getToken(tokens, surfaceToken)
                    ),
                    `${themeName}: muted-foreground on ${surfaceToken}`
                ).toBeGreaterThanOrEqual(minTextContrastRatio)
            }

            expect(
                contrastRatio(
                    getToken(tokens, 'secondary-foreground'),
                    getToken(tokens, 'surface-control')
                ),
                `${themeName}: secondary-foreground on surface-control`
            ).toBeGreaterThanOrEqual(minTextContrastRatio)
            expect(
                contrastRatio(
                    getToken(tokens, 'secondary-foreground'),
                    getToken(tokens, 'surface-control-hover')
                ),
                `${themeName}: secondary-foreground on surface-control-hover`
            ).toBeGreaterThanOrEqual(minTextContrastRatio)
            for (const surfaceToken of [
                'surface-background',
                'surface-raised',
                'surface-overlay',
            ]) {
                expect(
                    contrastRatio(getToken(tokens, 'primary'), getToken(tokens, surfaceToken)),
                    `${themeName}: primary link on ${surfaceToken}`
                ).toBeGreaterThanOrEqual(minTextContrastRatio)
            }

            expect(
                contrastRatio(getToken(tokens, 'primary-foreground'), getToken(tokens, 'primary')),
                `${themeName}: primary-foreground on primary`
            ).toBeGreaterThanOrEqual(minTextContrastRatio)
        })
    }
})

interface Oklch {
    readonly lightness: number
    readonly chroma: number
    readonly hue: number
}

function extractBlock(source: string, selector: string) {
    const block = source.match(
        new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`)
    )?.[1]

    if (!block) {
        throw new Error(`Could not find the ${selector} token block`)
    }

    return block
}

function parseTokens(block: string, names: readonly string[]) {
    return Object.fromEntries(names.map(name => [name, parseToken(block, name)])) as Record<
        string,
        Oklch
    >
}

function getToken(tokens: Record<string, Oklch>, name: string) {
    const token = tokens[name]

    if (!token) {
        throw new Error(`Token --${name} was not parsed`)
    }

    return token
}

function parseToken(block: string, name: string): Oklch {
    const hex = block.match(new RegExp(`--${escapeRegExp(name)}\\s*:\\s*#([0-9a-f]{6})`, 'i'))?.[1]
    if (hex) {
        const rgb = [0, 2, 4].map(index => {
            const channel = parseInt(hex.slice(index, index + 2), 16) / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        const [r, g, b] = rgb as [number, number, number]
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        const t = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * t
        const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * t
        return {
            lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * t,
            chroma: Math.hypot(a, labB),
            hue: (Math.atan2(labB, a) * 180) / Math.PI,
        }
    }

    const value = block.match(new RegExp(`--${escapeRegExp(name)}\\s*:\\s*oklch\\(([^)]+)\\)`))?.[1]

    if (!value) {
        throw new Error(`Could not find an OKLCH value for --${name}`)
    }

    const [lightnessValue, chromaValue, hueValue] = value.trim().split(/\s+/)
    const lightness = Number(lightnessValue)
    const chroma = Number(chromaValue)
    const hue = Number(hueValue)

    if (![lightness, chroma, hue].every(Number.isFinite)) {
        throw new Error(`Invalid OKLCH value for --${name}: ${value}`)
    }

    return { lightness, chroma, hue }
}

function contrastRatio(first: Oklch, second: Oklch) {
    const firstLuminance = relativeLuminance(first)
    const secondLuminance = relativeLuminance(second)
    const lighter = Math.max(firstLuminance, secondLuminance)
    const darker = Math.min(firstLuminance, secondLuminance)

    return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: Oklch) {
    const [red, green, blue] = oklchToLinearSrgb(color)

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function oklchToLinearSrgb({ lightness, chroma, hue }: Oklch): readonly [number, number, number] {
    const hueInRadians = (hue * Math.PI) / 180
    const labA = chroma * Math.cos(hueInRadians)
    const labB = chroma * Math.sin(hueInRadians)
    const l = Math.pow(lightness + 0.3963377774 * labA + 0.2158037573 * labB, 3)
    const m = Math.pow(lightness - 0.1055613458 * labA - 0.0638541728 * labB, 3)
    const s = Math.pow(lightness - 0.0894841775 * labA - 1.291485548 * labB, 3)

    return [
        clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ]
}

function clamp(value: number) {
    return Math.min(1, Math.max(0, value))
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
