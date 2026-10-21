'use client'

import { Button } from '@postdot/ui/components/button'
import {
    Dialog,
    DialogContent,
    DialogClose,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from '@postdot/ui/components/dialog'
import { useLenis } from 'lenis/react'

export function PublicScreenshot({
    name,
    title,
    eager = false,
}: {
    name: 'calendar' | 'queue'
    title: string
    eager?: boolean
}) {
    const lenis = useLenis()
    const sizes = { calendar: [1128, 720], queue: [1128, 700] } as const
    const size = sizes[name]
    return (
        <Dialog
            onOpenChange={open => {
                if (open) lenis?.stop()
                else lenis?.start()
            }}>
            <DialogTrigger
                render={
                    <Button
                        variant="ghost"
                        className="home-product-preview"
                        aria-label={`Open ${title.toLowerCase()} preview`}
                    />
                }>
                <img
                    className="home-shot home-shot-light"
                    src={`/product/${name}-detail-light.webp`}
                    alt={`${title} in Postdot, using an example project`}
                    width={size[0]}
                    height={size[1]}
                    loading={eager ? 'eager' : 'lazy'}
                />
                <img
                    className="home-shot home-shot-dark"
                    src={`/product/${name}-detail-dark.webp`}
                    alt={`${title} in Postdot in dark mode, using an example project`}
                    width={size[0]}
                    height={size[1]}
                    loading={eager ? 'eager' : 'lazy'}
                />
                <span className="home-preview-hint">Open preview</span>
            </DialogTrigger>
            <DialogContent className="home-screenshot-dialog" showCloseButton={false}>
                <div className="home-screenshot-dialog-header">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogClose render={<Button variant="ghost" className="home-preview-close" />}>
                        Close
                    </DialogClose>
                </div>
                <DialogDescription>
                    An example project in the real Postdot interface.
                </DialogDescription>
                <div className="home-screenshot-scroll" data-lenis-prevent>
                    <img
                        className="home-shot-light"
                        src={`/product/${name}-light.webp`}
                        alt={`${title} full preview`}
                        width={1440}
                        height={1000}
                    />
                    <img
                        className="home-shot-dark"
                        src={`/product/${name}-dark.webp`}
                        alt={`${title} full preview in dark mode`}
                        width={1440}
                        height={1000}
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}
