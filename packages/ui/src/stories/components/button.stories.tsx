import { DownloadMinimalisticIcon } from '@solar-icons/react/bold/download-minimalistic'
import { MenuDotsIcon } from '@solar-icons/react/bold/menu-dots'
import { TrashBinMinimalisticIcon } from '@solar-icons/react/bold/trash-bin-minimalistic'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../../components/button'

const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const
const sizes = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const

const meta = {
    title: 'Components/Button',
    component: Button,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
    argTypes: {
        variant: {
            control: 'select',
            options: variants,
        },
        size: {
            control: 'select',
            options: sizes,
        },
        disabled: {
            control: 'boolean',
        },
    },
    args: {
        variant: 'default',
        size: 'default',
        children: 'Action',
        disabled: false,
    },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
    render: () => (
        <div className="grid gap-3 sm:grid-cols-2">
            {variants.map(variant => (
                <Button key={variant} variant={variant}>
                    {variant === 'destructive' ? 'Delete' : variant}
                </Button>
            ))}
        </div>
    ),
}

export const IconActions: Story = {
    render: () => (
        <div className="flex items-center gap-1 rounded-lg bg-surface-raised p-2 shadow-surface">
            <Button aria-label="Download" size="icon-sm" variant="ghost">
                <DownloadMinimalisticIcon aria-hidden="true" />
            </Button>
            <Button aria-label="More actions" size="icon-sm" variant="ghost">
                <MenuDotsIcon aria-hidden="true" />
            </Button>
            <Button aria-label="Delete" size="icon-sm" variant="destructive">
                <TrashBinMinimalisticIcon aria-hidden="true" />
            </Button>
        </div>
    ),
}

export const InContext: Story = {
    render: () => (
        <section className="flex w-full max-w-lg items-center justify-between gap-4 rounded-lg bg-surface-raised p-4 shadow-surface">
            <div className="min-w-0">
                <p className="font-medium">Resource actions</p>
                <p className="text-sm text-muted-foreground">
                    A primary action, a quiet action, and a destructive action.
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost">Cancel</Button>
                <Button>Save</Button>
            </div>
        </section>
    ),
}
