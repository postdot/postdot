import { Button } from '@postdot/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ChannelContentChanges } from '@/components/channel-content-changes'
import { ChannelRequestBuilder } from '@/components/channel-request-builder'
import { LanguageProvider } from '@/lib/i18n'

const meta = {
    title: 'Channels/Mapped request',
    parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj
export const ExistingContract: Story = { render: () => <RequestExample /> }

export const WithoutBody: Story = { render: () => <RequestExample withoutBody /> }

function RequestExample({ withoutBody = false }: { readonly withoutBody?: boolean }) {
    const [profile, setProfile] = useState<Record<string, unknown>>(() => {
        const initial = {
            origin: 'custom',
            contentSchema: {
                type: 'object',
                properties: { body: { type: 'string' }, headline: { type: 'string' } },
            },
            fieldBindings: [
                { id: 'body', path: '/body', semantic: 'primary_text' },
                { id: 'headline', path: '/headline', semantic: 'headline' },
            ],
            execution: {
                kind: 'declarative_http',
                mode: 'mapped_http',
                contractId: 'story',
                revision: '1',
                request: {
                    method: 'POST',
                    query: {
                        format: { kind: 'literal', value: 'compact' },
                        delivery: { kind: 'context', pointer: '/deliveryId' },
                    },
                    path: ['posts', { kind: 'secret' }, { kind: 'content', pointer: '/slug' }],
                    body: {
                        kind: 'json',
                        value: {
                            kind: 'object',
                            properties: {
                                text: { kind: 'literal', value: 'An announcement' },
                                source: { kind: 'content', pointer: '/body' },
                                published: { kind: 'literal', value: false },
                                priority: { kind: 'literal', value: 1 },
                                metadata: {
                                    kind: 'object',
                                    properties: { source: { kind: 'literal', value: 'Postdot' } },
                                },
                            },
                        },
                    },
                    response: {
                        successStatuses: [201],
                        retryableStatuses: [429],
                        rejectedStatuses: [400],
                        ambiguousStatuses: [500],
                        externalIdPointer: '/id',
                    },
                },
            },
        }
        if (withoutBody) Reflect.deleteProperty(initial.execution.request, 'body')
        return initial
    })
    const [before] = useState(() => structuredClone(profile))
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
                    <ChannelContentChanges before={before} after={JSON.stringify(profile)} />
                    <Button disabled={!valid} type="button">
                        Save profile
                    </Button>
                </div>
            </div>
        </LanguageProvider>
    )
}
