import { useEffect, useRef, type ReactNode } from 'react'

import './dot-field.css'
import { runField, type FieldPalette, type FieldScene } from './engine'

const accentTokens = {
    published: '--field-published',
    queued: '--field-queued',
    attention: '--field-attention',
    draft: '--field-draft',
} as const

function readPalette(element: HTMLElement): FieldPalette {
    const style = getComputedStyle(element)
    const read = (token: string, fallback: string) =>
        style.getPropertyValue(token).trim() || fallback
    return {
        ink: read('--field-ink', '#888888'),
        route: read('--field-route', '#2457d6'),
        accents: Object.fromEntries(
            Object.entries(accentTokens).map(([name, token]) => [name, read(token, '#888888')])
        ),
    }
}

/**
 * A decorative scene. Children are the scene's nodes: give each one `data-field-node="<id>"` and
 * lay them out with ordinary CSS. The canvas draws the dot field and routes behind them.
 */
export function DotField({
    scene,
    className = '',
    label,
    grid = 'field',
    fill = false,
    children,
}: {
    scene: FieldScene
    className?: string
    /** Text alternative for the whole scene. */
    label: string
    /** `bare` scenes sit on the page or card surface without their own panel. */
    grid?: 'field' | 'none'
    /** Lay the children over the whole container, which the caller sizes. */
    fill?: boolean
    children: ReactNode
}) {
    const container = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const element = container.current
        const surface = canvas.current
        if (!element || !surface) return
        return runField({
            container: element,
            canvas: surface,
            scene,
            grid,
            readPalette: () => readPalette(element),
        })
    }, [scene, grid])

    return (
        <div ref={container} role="img" aria-label={label} className={`dot-field ${className}`}>
            <canvas ref={canvas} className="dot-field-canvas" aria-hidden="true" />
            <div
                className={`dot-field-layout ${fill ? 'dot-field-layout-fill' : ''}`}
                aria-hidden="true">
                {children}
            </div>
        </div>
    )
}
