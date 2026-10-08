import { Textarea } from '@herald/ui/components/textarea'
import { SolarProvider } from '@solar-icons/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { PublicationComposer } from '@/components/publication-composer'
import { PublicationDraftPreview } from '@/components/publication-draft-preview'
import {
    PublicationChannelTabs,
    publicationSharedTabId,
} from '@/components/publication-target-list'
import type { ChannelListItem } from '@/lib/api'
import { LanguageProvider } from '@/lib/i18n'
import { createPublicationTarget } from '@/lib/publication-authoring'

const channels: ChannelListItem[] = ['linkedin', 'bluesky', 'mastodon', 'x'].map(
    (profileId, index) => ({
        id: profileId,
        projectId: 'composer-demo',
        profileId,
        execution: { kind: 'built_in', contractId: profileId },
        profileVersionId: profileId,
        name: ['Herald', 'Studio', 'Community', 'News'][index]!,
        state: 'active',
        archivedAt: null,
        revision: 1,
        createdAt: 0,
        updatedAt: 0,
    })
)

const meta = {
    title: 'Publications/Composer',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj

export const ChannelSelection: Story = { render: () => <ComposerExample /> }
export const Mobile: Story = {
    render: () => (
        <div className="max-w-[390px]">
            <ComposerExample />
        </div>
    ),
}
export const PlatformPreviews: Story = {
    render: () => (
        <LanguageProvider>
            <SolarProvider>
                <div className="grid gap-8 bg-surface-canvas p-8 text-foreground md:grid-cols-2">
                    {channels.slice(0, 2).map(channel => (
                        <PublicationDraftPreview
                            key={channel.id}
                            channel={channel}
                            execution={channel?.execution ?? { kind: 'manual' }}
                            media={[]}
                            postTitle=""
                            postContent="A small glimpse of what we have been building. More room for ideas, fewer distractions."
                        />
                    ))}
                </div>
            </SolarProvider>
        </LanguageProvider>
    ),
}

function ComposerExample() {
    const [targets, setTargets] = useState(() => [createPublicationTarget('linkedin')])
    const [activeId, setActiveId] = useState(publicationSharedTabId)
    const [content, setContent] = useState(
        'A small glimpse of what we have been building. More room for ideas, fewer distractions.'
    )
    const target = targets.find(item => item.id === activeId)
    const channel = channels.find(item => item.id === (target?.channelId ?? 'linkedin'))

    return (
        <LanguageProvider>
            <SolarProvider>
                <div className="min-h-96 bg-surface-canvas p-5 text-foreground">
                    <PublicationComposer
                        channelNavigation={
                            <PublicationChannelTabs
                                activeTabId={activeId}
                                channels={channels}
                                defaultDeliveryMode="manual"
                                defaultScheduledAt="2026-10-01T10:00"
                                disabled={false}
                                onChange={setTargets}
                                onActiveTabChange={setActiveId}
                                onRemoveTarget={targetId => {
                                    if (activeId === targetId) setActiveId(publicationSharedTabId)
                                    setTargets(current =>
                                        current.filter(target => target.id !== targetId)
                                    )
                                }}
                                projectId="composer-demo"
                                targets={targets}
                                timeZone="UTC"
                            />
                        }
                        editor={
                            <Textarea
                                aria-label={
                                    activeId === publicationSharedTabId
                                        ? 'Shared content'
                                        : 'Content'
                                }
                                className="min-h-64 rounded-xl border-0 bg-surface-field p-4 shadow-surface"
                                value={content}
                                onChange={event => setContent(event.target.value)}
                            />
                        }
                        preview={
                            <PublicationDraftPreview
                                channel={channel}
                                execution={channel?.execution ?? { kind: 'manual' }}
                                media={[]}
                                postTitle=""
                                postContent={content}
                            />
                        }
                    />
                </div>
            </SolarProvider>
        </LanguageProvider>
    )
}
