import { telegramChannelProfile } from '@postdot/telegram'
import { Button } from '@postdot/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ChannelComposerPreview } from '@/components/channel-composer-preview'
import { TelegramConnectionDialog } from '@/components/telegram-connection-dialog'
import type { Channel } from '@/lib/api'
import { LanguageProvider } from '@/lib/i18n'

const channel: Channel = {
    id: 'telegram-story',
    projectId: 'telegram-story-project',
    name: 'Announcements',
    profileId: 'telegram',
    profileVersionId: 'telegram-v1',
    state: 'active',
    archivedAt: null,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
}
const meta = { title: 'Channels/Telegram', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj
export const ConnectionFailure: Story = {
    render: () => (
        <LanguageProvider>
            <div className="min-h-screen bg-background p-8 text-foreground">
                <TelegramConnectionDialog
                    channel={channel}
                    disabled={false}
                    onConnect={async () => false}
                />
            </div>
        </LanguageProvider>
    ),
}
export const EditorConstraints: Story = { render: () => <EditorExample /> }
function EditorExample() {
    const [target, setTarget] = useState<Record<string, unknown>>({
        text: 'A short announcement',
        media: [],
    })
    const hasMedia = Array.isArray(target.media) && target.media.length > 0
    return (
        <LanguageProvider>
            <div className="min-h-screen bg-background p-5 text-foreground">
                <div className="mx-auto max-w-xl space-y-4">
                    <Button
                        variant="outline"
                        onClick={() =>
                            setTarget(current => ({
                                ...current,
                                media: hasMedia ? [] : [{ assetId: 'example' }],
                            }))
                        }>
                        {hasMedia ? 'Remove example media' : 'Attach example media'}
                    </Button>
                    <ChannelComposerPreview
                        projectId={channel.projectId}
                        scopeId={channel.id}
                        profile={telegramChannelProfile}
                        target={target}
                        onChange={setTarget}
                        disabled={false}
                    />
                </div>
            </div>
        </LanguageProvider>
    )
}
