import { Button } from '@postbot/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ChannelRequestBuilder } from '@/components/channel-request-builder'
import { LanguageProvider } from '@/lib/i18n'

const meta = {
    title: 'Channels/Mapped request',
    parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj
export const ExistingContract: Story = { render: () => <RequestExample /> }

function RequestExample() {
    const [profile, setProfile] = useState<Record<string, unknown>>({
        origin: 'custom',
        execution: {
            kind: 'declarative_http',
            mode: 'mapped_http',
            contractId: 'story',
            revision: '1',
            request: {
                method: 'POST',
                path: ['posts', { kind: 'secret' }, { kind: 'content', pointer: '/slug' }],
                body: { kind: 'json', value: { kind: 'content', pointer: '/body' } },
                response: {
                    successStatuses: [201],
                    retryableStatuses: [429],
                    rejectedStatuses: [400],
                    ambiguousStatuses: [500],
                    externalIdPointer: '/id',
                },
            },
        },
    })
    const [valid, setValid] = useState(true)
    return (
        <LanguageProvider>
            <div className="min-h-screen bg-background p-5 text-foreground">
                <div className="mx-auto grid max-w-xl gap-4">
                    <ChannelRequestBuilder
                        profile={profile}
                        onChange={setProfile}
                        disabled={false}
                        onValidityChange={setValid}
                    />
                    <Button disabled={!valid} type="button">
                        Save profile
                    </Button>
                </div>
            </div>
        </LanguageProvider>
    )
}
