import { Button } from '@postbot/ui/components/button'
import { BellIcon } from '@solar-icons/react/linear/bell'
import { KeyMinimalisticIcon } from '@solar-icons/react/linear/key-minimalistic'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyState } from '@/components/empty-state'

const meta = {
    title: 'Feedback/Empty state',
    component: EmptyState,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>

export default meta

type Story = StoryObj<typeof meta>

export const Queue: Story = {
    args: { title: 'Queue is empty' },
    render: () => (
        <div className="max-w-3xl">
            <EmptyState
                action={<Button size="sm">New publication</Button>}
                description="Create a publication to add work here."
                illustration="data"
                title="Queue is empty"
            />
        </div>
    ),
}

export const PlatformSpecificStates: Story = {
    args: { title: 'Empty state examples' },
    render: () => (
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
            <EmptyState
                description="Scheduled publications will appear here."
                illustration="event"
                title="Nothing scheduled"
            />
            <EmptyState illustration="image" title="No media yet" />
            <EmptyState illustration="notifications" title="No notifications" />
            <EmptyState illustration="access" title="No active membership" />
            <EmptyState
                description="Reconnect to continue."
                illustration="network"
                title="Connection unavailable"
            />
        </div>
    ),
}

export const Compact: Story = {
    args: { title: 'Compact empty state' },
    render: () => (
        <div className="grid max-w-2xl gap-3">
            <EmptyState
                description="Create a token for an integration that needs project access."
                icon={<KeyMinimalisticIcon aria-hidden="true" />}
                layout="compact"
                title="No API keys"
            />
            <EmptyState
                icon={<BellIcon aria-hidden="true" />}
                layout="compact"
                title="No notifications"
            />
        </div>
    ),
}
