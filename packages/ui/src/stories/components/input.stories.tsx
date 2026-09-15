import { MagnifierIcon } from '@solar-icons/react/bold/magnifier'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '../../components/button'
import { Field, FieldDescription, FieldLabel } from '../../components/field'
import { Input } from '../../components/input'

const meta = {
    title: 'Components/Input',
    component: Input,
    tags: ['autodocs'],
    parameters: {
        layout: 'centered',
    },
    argTypes: {
        disabled: {
            control: 'boolean',
        },
        type: {
            control: 'select',
            options: ['text', 'email', 'password', 'number'],
        },
    },
    args: {
        type: 'text',
        placeholder: 'Enter a value',
        disabled: false,
    },
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const WithField: Story = {
    render: args => (
        <Field className="w-full max-w-sm">
            <FieldLabel htmlFor="storybook-input">File name</FieldLabel>
            <Input {...args} id="storybook-input" />
            <FieldDescription>The name will be visible in the media library.</FieldDescription>
        </Field>
    ),
}

export const SearchPattern: Story = {
    render: () => (
        <section className="w-full max-w-xl rounded-lg bg-surface-raised p-4 shadow-surface">
            <div className="relative">
                <MagnifierIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    aria-label="Search the library"
                    className="pl-9"
                    placeholder="Search the library"
                />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">15 media items available</span>
                <Button size="sm" variant="secondary">
                    Reset
                </Button>
            </div>
        </section>
    ),
}

export const Disabled: Story = {
    args: {
        disabled: true,
        placeholder: 'Unavailable',
    },
}
