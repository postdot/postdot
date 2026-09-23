import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../../components/button'
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '../../components/dialog'

const meta = {
    title: 'Components/Dialog',
    component: Dialog,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
} satisfies Meta<typeof Dialog>

export default meta

type Story = StoryObj<typeof meta>

export const Confirmation: Story = {
    render: () => <ConfirmationDialog />,
}

export const LongContent: Story = {
    render: () => (
        <Dialog>
            <DialogTrigger render={<Button variant="secondary" />}>Preview</DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Resource details</DialogTitle>
                    <DialogDescription>
                        Content can grow without losing clear separation between the header, body,
                        and actions.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 rounded-md bg-surface-inset p-3 text-sm text-muted-foreground">
                    <p>Format: image/jpeg</p>
                    <p>Dimensions: 5,279 x 3,519 px</p>
                    <p>Usage: 2 publications</p>
                </div>
                <DialogFooter>
                    <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
                    <Button>Edit</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    ),
}

function ConfirmationDialog() {
    return (
        <Dialog>
            <DialogTrigger render={<Button variant="destructive" />}>Delete media</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete this media?</DialogTitle>
                    <DialogDescription>
                        This action removes the file from the library. Publications that use it
                        should be reviewed before deletion.
                    </DialogDescription>
                </DialogHeader>
                <div className="rounded-md bg-surface-inset p-3 text-sm">
                    <p className="font-medium">watchtower-mountains-and-forests.jpg</p>
                    <p className="mt-1 text-muted-foreground">image/jpeg · 2.7 MB</p>
                </div>
                <DialogFooter>
                    <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
                    <DialogClose render={<Button variant="destructive" />}>Delete</DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
