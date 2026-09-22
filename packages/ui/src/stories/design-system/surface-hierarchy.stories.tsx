import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '../../components/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../../components/select'

const meta = {
    title: 'Foundations/Surface hierarchy',
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const ActiveTheme: Story = {
    render: () => <SurfaceTheme name="Active theme" />,
}

function SurfaceTheme({ name }: { readonly name: string }) {
    return (
        <div className="min-h-screen bg-background p-4 text-foreground sm:p-7">
            <section
                className="bg-surface-canvas p-5 sm:p-7"
                data-theme-preview={name.toLowerCase()}>
                <header className="mb-6 flex items-baseline justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase">
                            Theme
                        </p>
                        <h2 className="font-heading mt-1 text-xl font-semibold">{name}</h2>
                    </div>
                    <span className="rounded-full bg-surface-inset px-2.5 py-1 text-xs text-muted-foreground">
                        Neutral
                    </span>
                </header>
                <div className="grid gap-3">
                    <SurfaceSwatch
                        description="Global page and application chrome"
                        label="Background"
                        surface="bg-background"
                    />
                    <SurfaceSwatch
                        description="Main work area"
                        label="Canvas"
                        surface="bg-surface-canvas"
                    />
                    <SurfaceSwatch
                        description="Dividers, footers, and secondary areas"
                        label="Inset / muted"
                        surface="bg-surface-inset"
                    />
                    <SurfaceSwatch
                        description="Input fields and nested content"
                        label="Field"
                        surface="bg-surface-field"
                    />
                    <SurfaceSwatch
                        description="Neutral actions and interactive selectors"
                        label="Control"
                        surface="bg-surface-control"
                    />
                    <SurfaceSwatch
                        description="Cards and elevated containers"
                        label="Raised"
                        surface="bg-surface-raised"
                    />
                    <SurfaceSwatch
                        description="Dialogs and menus layered above the page"
                        label="Overlay"
                        surface="bg-surface-overlay"
                    />
                </div>

                <div className="mt-6 rounded-lg bg-surface-raised p-4 shadow-surface">
                    <p className="mb-3 text-xs font-semibold text-muted-foreground uppercase">
                        Neutral controls
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary">Done</Button>
                        <Button variant="ghost">Cancel</Button>
                        <ThemeSelect />
                    </div>
                </div>
            </section>
        </div>
    )
}

function SurfaceSwatch({
    description,
    label,
    surface,
}: {
    readonly description: string
    readonly label: string
    readonly surface: string
}) {
    return (
        <div className={`${surface} rounded-md p-3 shadow-field`}>
            <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{label}</span>
                <code className="text-xs text-muted-foreground">{surface.replace('bg-', '')}</code>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
    )
}

function ThemeSelect() {
    const [value, setValue] = useState('all')

    return (
        <Select value={value} onValueChange={nextValue => setValue(nextValue ?? 'all')}>
            <SelectTrigger className="w-36" size="sm" aria-label="Example select">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="image">Images</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
            </SelectContent>
        </Select>
    )
}
