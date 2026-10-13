import { SolarProvider } from '@solar-icons/react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import type { ChannelListItem, PublisherConnection } from '@/lib/api'
import { LanguageProvider } from '@/lib/i18n'

const STORY_PROJECT_ID = 'publisher-connections-story'

const channels: ChannelListItem[] = [
    createChannel('manual', 'Manual publishing', 'manual-message'),
    createChannel('active', 'LinkedIn account', 'linkedin'),
    createChannel('reconnect', 'Expired LinkedIn account', 'linkedin'),
    createChannel('revoked', 'Revoked webhook', 'custom-webhook'),
]

const connections: PublisherConnection[] = [
    createConnection({
        channelId: 'active',
        destination: { type: 'member', id: 'member-1', name: 'Postbot team' },
        externalAccountId: 'member-1',
        externalAccountName: 'Postbot team',
        kind: 'linkedin',
        providerId: 'linkedin',
        state: 'active',
    }),
    createConnection({
        channelId: 'reconnect',
        destination: { type: 'member', id: 'member-2', name: 'Expired account' },
        externalAccountId: 'member-2',
        externalAccountName: 'Expired account',
        kind: 'linkedin',
        providerId: 'linkedin',
        state: 'reconnect_required',
    }),
    createConnection({
        channelId: 'revoked',
        endpointUrl: 'https://example.test/publish',
        kind: 'custom_http',
        providerId: 'custom_http',
        state: 'revoked',
    }),
]

const meta = {
    title: 'Channels/Readiness',
    component: PublisherConnectionPanel,
    parameters: { layout: 'fullscreen' },
    tags: ['autodocs'],
} satisfies Meta<typeof PublisherConnectionPanel>

export default meta

type Story = StoryObj

export const ConnectionStates: Story = {
    render: () => (
        <LanguageProvider>
            <SolarProvider>
                <div className="min-h-screen bg-surface-canvas p-6 text-foreground sm:p-10">
                    <div className="mx-auto max-w-5xl">
                        <PublisherConnectionPanel
                            channels={channels}
                            connections={connections}
                            pending={false}
                            onEditProfile={() => undefined}
                            onLifecycleAction={() => undefined}
                            onConnectCustomHttpPublisher={async () => false}
                            onConnectDiscordPublisher={async () => false}
                            onConnectDevtoPublisher={async () => false}
                            onDisconnectPublisher={async () => undefined}
                            onStartBlueskyConnection={async () => undefined}
                            onStartLinkedInConnection={async () => undefined}
                            onStartMastodonConnection={async () => undefined}
                            onStartXConnection={async () => undefined}
                        />
                    </div>
                </div>
            </SolarProvider>
        </LanguageProvider>
    ),
}

function createChannel(id: string, name: string, profileId: string): ChannelListItem {
    return {
        id,
        projectId: STORY_PROJECT_ID,
        profileId,
        execution:
            profileId === 'manual-message'
                ? { kind: 'manual' }
                : profileId === 'custom-webhook'
                  ? { kind: 'declarative_http' }
                  : { kind: 'built_in', contractId: profileId },
        profileVersionId: `${profileId}-v1`,
        name,
        state: 'active',
        archivedAt: null,
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
    }
}

function createConnection({
    channelId,
    destination = null,
    endpointUrl = null,
    externalAccountId = `${channelId}-account`,
    externalAccountName = null,
    kind,
    providerId,
    state,
}: {
    readonly channelId: string
    readonly destination?: PublisherConnection['destination']
    readonly endpointUrl?: string | null
    readonly externalAccountId?: string
    readonly externalAccountName?: string | null
    readonly kind: string
    readonly providerId: string
    readonly state: PublisherConnection['state']
}): PublisherConnection {
    return {
        id: `${channelId}-connection`,
        projectId: STORY_PROJECT_ID,
        publisherId: `${channelId}-publisher`,
        channelId,
        kind,
        credentialId: `${channelId}-credential`,
        endpointUrl,
        authentication: null,
        destination,
        providerId,
        externalAccountId,
        externalAccountName,
        scopes: [],
        state,
        connectedByActorId: 'storybook',
        createdAt: 0,
        updatedAt: 0,
    }
}
