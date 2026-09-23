import { InfoCircleIcon } from '@solar-icons/react/linear/info-circle'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../../components/button'
import { Kbd } from '../../components/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/tooltip'

const meta = {
    title: 'Components/Tooltip',
    component: TooltipContent,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
    argTypes: {
        side: {
            control: 'select',
            options: ['top', 'bottom', 'left', 'right'],
        },
    },
    args: {
        side: 'top',
        children: 'Show information',
    },
} satisfies Meta<typeof TooltipContent>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {
    render: args => (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button aria-label="Information" size="icon" variant="ghost">
                            <InfoCircleIcon aria-hidden="true" />
                        </Button>
                    }
                />
                <TooltipContent {...args} />
            </Tooltip>
        </TooltipProvider>
    ),
}

export const WithShortcut: Story = {
    render: () => (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger render={<Button variant="secondary" />}>Import</TooltipTrigger>
                <TooltipContent>
                    <span>Import a file</span>
                    <Kbd>U</Kbd>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    ),
}
