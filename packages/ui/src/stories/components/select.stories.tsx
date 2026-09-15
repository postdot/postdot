import type { Meta, StoryObj } from '@storybook/react-vite'

import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '../../components/select'

const meta = {
    title: 'Components/Select',
    component: Select,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
} satisfies Meta<typeof Select>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {
    render: () => <SelectExample />,
}

export const GroupedOptions: Story = {
    render: () => (
        <Select defaultValue="all">
            <SelectTrigger aria-label="Filter by type" className="w-52">
                <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    <SelectLabel>Media types</SelectLabel>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                    <SelectLabel>Status</SelectLabel>
                    <SelectItem value="used">Used</SelectItem>
                    <SelectItem value="unused">Unused</SelectItem>
                    <SelectItem disabled value="archived">
                        Archived
                    </SelectItem>
                </SelectGroup>
            </SelectContent>
        </Select>
    ),
}

export const InToolbar: Story = {
    render: () => (
        <div className="flex w-full max-w-xl flex-wrap items-center gap-2 rounded-lg bg-surface-raised p-3 shadow-surface">
            <span className="mr-auto text-sm font-medium">Media</span>
            <Select defaultValue="recent">
                <SelectTrigger aria-label="Sort media" className="w-36" size="sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="recent">Most recent</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                </SelectContent>
            </Select>
        </div>
    ),
}

function SelectExample() {
    return (
        <Select defaultValue="all">
            <SelectTrigger aria-label="Select a type" className="w-64">
                <SelectValue placeholder="Select a type" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All media</SelectItem>
                <SelectItem value="image">Images only</SelectItem>
                <SelectItem value="video">Videos only</SelectItem>
            </SelectContent>
        </Select>
    )
}
