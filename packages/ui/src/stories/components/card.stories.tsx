import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '../../components/badge'
import { Button } from '../../components/button'
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '../../components/card'

const meta = {
    title: 'Components/Card',
    component: Card,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
    args: {
        className: 'w-full max-w-md',
    },
} satisfies Meta<typeof Card>

export default meta

type Story = StoryObj<typeof meta>

export const WithHeaderBodyAndFooter: Story = {
    render: args => (
        <Card {...args}>
            <CardHeader>
                <CardTitle>Media library</CardTitle>
                <CardDescription>Resources available for this project.</CardDescription>
                <CardAction>
                    <Badge variant="secondary">15 files</Badge>
                </CardAction>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground">
                    The card keeps a raised surface while its footer is distinguished as a secondary
                    area.
                </p>
            </CardContent>
            <CardFooter className="justify-end gap-2">
                <Button variant="ghost">Cancel</Button>
                <Button>Open</Button>
            </CardFooter>
        </Card>
    ),
}

export const Minimal: Story = {
    render: args => (
        <Card {...args}>
            <CardContent>
                <p className="text-sm">A card can also remain strictly informative.</p>
            </CardContent>
        </Card>
    ),
}
