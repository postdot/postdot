import { FullScreenIcon } from '@solar-icons/react/linear/full-screen'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../../components/button'
import { Kbd, KbdGroup } from '../../components/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/tooltip'

const meta = {
    title: 'Components/Kbd',
    component: Kbd,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
} satisfies Meta<typeof Kbd>

export default meta

type Story = StoryObj<typeof meta>

export const Shortcuts: Story = {
    render: () => (
        <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-2">
                Open
                <Kbd>Enter</Kbd>
            </span>
            <span className="inline-flex items-center gap-2">
                Close
                <Kbd>Esc</Kbd>
            </span>
            <span className="inline-flex items-center gap-2">
                Search
                <KbdGroup>
                    <Kbd>Ctrl</Kbd>
                    <Kbd>K</Kbd>
                </KbdGroup>
            </span>
        </div>
    ),
}

export const InTooltip: Story = {
    render: () => (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button aria-label="Full screen" size="icon" variant="ghost">
                            <FullScreenIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <TooltipContent>
                    <span>Full screen</span>
                    <Kbd>F</Kbd>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ),
}
