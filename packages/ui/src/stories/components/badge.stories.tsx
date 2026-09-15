import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '../../components/badge'

const variants = ['default', 'secondary', 'destructive', 'outline'] as const

const meta = {
    title: 'Components/Badge',
    component: Badge,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
    argTypes: {
        variant: {
            control: 'select',
            options: variants,
        },
    },
    args: {
        variant: 'default',
        children: 'Status',
    },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
    render: () => (
        <div className="flex flex-wrap items-center gap-2">
            {variants.map(variant => (
                <Badge key={variant} variant={variant}>
                    {variant}
                </Badge>
            ))}
        </div>
    ),
}
