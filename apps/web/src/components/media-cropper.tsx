/**
 * Postdot's crop editor parts, built on the zriz engine (`@zriz/core`, `@zriz/react`): the
 * engine owns geometry, gestures, straightening and accessibility; these parts own the look,
 * the words and the icons. Adapted from the zriz shadcn blocks (MIT).
 */
import { Button } from '@postdot/ui/components/button'
import { cn } from '@postdot/ui/lib/utils'
import { CameraRotateIcon } from '@solar-icons/react/linear/camera-rotate'
import { RefreshCircleIcon } from '@solar-icons/react/linear/refresh-circle'
import type {
    AspectGroupProps,
    AspectItemProps,
    CommitDetails,
    CropValue,
    DialProps,
    FlipProps,
    ResetProps,
    RootProps,
    RotateProps,
    ViewportProps,
} from '@zriz/react'
import * as CropperPrimitive from '@zriz/react/cropper'
import type { ComponentProps } from 'react'

import * as m from '@/paraglide/messages.js'

import '@zriz/react/styles.css'

type Styled<P> = Omit<P, 'className'> & { readonly className?: string }

const HANDLES = [
    'top-left',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
] as const

const iconButton = 'aria-disabled:pointer-events-none aria-disabled:opacity-50'

function announce(_: CropValue, details: CommitDetails): string | null {
    switch (details.reason) {
        case 'flip':
            return m.media_editor_announce_flipped()
        case 'orientation':
            return m.media_editor_announce_orientation()
        case 'reset':
            return m.media_editor_announce_reset()
        case 'rotate-90':
            return m.media_editor_announce_turned()
        default:
            return null
    }
}

function formatAngle(degrees: number): string {
    const rounded = Math.round(degrees)
    return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}°`
}

export function Cropper({ children, className, ...props }: Styled<RootProps>) {
    return (
        <CropperPrimitive.Root
            className={cn(
                'flex w-full min-w-0 flex-col [--zriz-accent:var(--color-primary)] [--zriz-line:var(--color-foreground)] [--zriz-tick:var(--color-muted-foreground)]',
                className
            )}
            data-slot="cropper"
            {...props}>
            {children}
            <CropperPrimitive.Instructions>
                {m.media_editor_instructions()}
            </CropperPrimitive.Instructions>
            <CropperPrimitive.Announcer announce={announce} />
        </CropperPrimitive.Root>
    )
}

export function CropperViewport({ className, ...props }: Styled<Omit<ViewportProps, 'children'>>) {
    return (
        <CropperPrimitive.Viewport
            className={cn('relative w-full p-6', className)}
            data-slot="cropper-viewport"
            {...props}>
            <CropperPrimitive.Image />
            <CropperPrimitive.Mask />
            <CropperPrimitive.Area aria-label={m.media_editor_crop_area()}>
                <CropperPrimitive.Grid />
                {HANDLES.map(position => (
                    <CropperPrimitive.Handle key={position} position={position} />
                ))}
            </CropperPrimitive.Area>
        </CropperPrimitive.Viewport>
    )
}

export function CropperDial({ className, ...props }: Styled<Omit<DialProps, 'children'>>) {
    return (
        <div
            className={cn(
                'relative h-10 min-w-0 flex-1 rounded-md ring-ring/50 has-focus-visible:ring-3',
                className
            )}
            data-slot="cropper-dial">
            <div className="absolute inset-x-0 top-[11px]">
                <CropperPrimitive.Dial
                    aria-label={m.media_editor_straighten()}
                    className="w-full outline-none"
                    {...props}>
                    <CropperPrimitive.DialTicks />
                </CropperPrimitive.Dial>
            </div>
        </div>
    )
}

export function CropperAngle({ className, ...props }: ComponentProps<'span'>) {
    return (
        <span
            className={cn('w-10 text-center text-xs text-muted-foreground tabular-nums', className)}
            data-slot="cropper-angle"
            {...props}>
            <CropperPrimitive.DialValue format={formatAngle} />
        </span>
    )
}

export function CropperRotate(props: RotateProps) {
    return (
        <CropperPrimitive.Rotate
            aria-label={m.media_editor_rotate_left()}
            render={<Button className={iconButton} type="button" size="icon" variant="ghost" />}
            {...props}>
            <CameraRotateIcon aria-hidden="true" />
        </CropperPrimitive.Rotate>
    )
}

export function CropperFlip(props: FlipProps) {
    return (
        <CropperPrimitive.Flip
            aria-label={m.media_editor_flip()}
            render={<Button className={iconButton} type="button" size="icon" variant="ghost" />}
            {...props}>
            {/* Two mirrored halves: the usual flip mark, drawn to match Solar's line weight. */}
            <svg
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 20 20">
                <path d="M8.5 4.5V15.5H3.5Z" />
                <path d="M11.5 4.5V15.5H16.5Z" />
            </svg>
        </CropperPrimitive.Flip>
    )
}

export function CropperReset(props: ResetProps) {
    return (
        <CropperPrimitive.Reset
            render={<Button className={iconButton} type="button" size="sm" variant="ghost" />}
            {...props}>
            <RefreshCircleIcon aria-hidden="true" />
            {m.media_editor_reset()}
        </CropperPrimitive.Reset>
    )
}

export function CropperAspect({ className, ...props }: Styled<AspectGroupProps>) {
    return (
        <CropperPrimitive.AspectGroup
            aria-label={m.media_editor_aspect()}
            className={cn(
                'inline-flex h-8 w-fit max-w-full items-center overflow-x-auto rounded-lg bg-surface-raised p-[3px] text-muted-foreground',
                className
            )}
            data-slot="cropper-aspect"
            {...props}
        />
    )
}

export function CropperAspectItem({ className, ...props }: Styled<AspectItemProps>) {
    return (
        <CropperPrimitive.AspectItem
            className={cn(
                'inline-flex h-full items-center justify-center rounded-md border border-transparent px-2 text-sm font-medium whitespace-nowrap outline-none select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm',
                className
            )}
            data-slot="cropper-aspect-item"
            {...props}
        />
    )
}
