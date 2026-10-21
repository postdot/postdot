import { Button } from '@postdot/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { FacebookPagePickerDialog } from '@/components/facebook-page-picker-dialog'
import { ApiError } from '@/lib/api'
import { LanguageProvider } from '@/lib/i18n'

const meta = {
    title: 'Channels/Facebook Pages',
    component: FacebookPagePickerDialog,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FacebookPagePickerDialog>
export default meta

type Story = StoryObj
const pages = [
    { id: '101', name: 'Postdot — Product updates', hasPublishTask: true },
    { id: '102', name: 'Community', hasPublishTask: false },
    { id: '103', name: 'Studio announcements', hasPublishTask: true },
]
const loadPages: NonNullable<
    React.ComponentProps<typeof FacebookPagePickerDialog>['loadPages']
> = async (_project, _channel, _selection, after) => ({
    pages: after ? [{ id: '104', name: 'International community', hasPublishTask: true }] : pages,
    nextCursor: after ? null : 'next-page',
})
function Example({ state = 'ready' }: { readonly state?: 'ready' | 'empty' | 'expired' | 'many' }) {
    const [open, setOpen] = useState(true)
    return (
        <LanguageProvider>
            <div className="min-h-screen bg-background p-8">
                <Button onClick={() => setOpen(true)}>Open Page picker</Button>
                {open ? (
                    <FacebookPagePickerDialog
                        projectId="story"
                        channelId="story"
                        channelName="Facebook"
                        selection={'synthetic-selection-'.repeat(3)}
                        onClose={() => setOpen(false)}
                        onConnected={async () => setOpen(false)}
                        loadPages={
                            state === 'many'
                                ? async () => ({
                                      pages: Array.from({ length: 20 }, (_, index) => ({
                                          id: String(200 + index),
                                          name: `Community and product announcements ${index + 1}`,
                                          hasPublishTask: index % 4 !== 0,
                                      })),
                                      nextCursor: null,
                                  })
                                : state === 'ready'
                                  ? loadPages
                                  : state === 'empty'
                                    ? async () => ({ pages: [], nextCursor: null })
                                    : async () => {
                                          throw new ApiError(
                                              400,
                                              'invalid_attempt',
                                              'Connection expired'
                                          )
                                      }
                        }
                        connectPage={async () => undefined}
                    />
                ) : null}
            </div>
        </LanguageProvider>
    )
}
export const PageChoices: Story = { render: () => <Example /> }
export const Empty: Story = { render: () => <Example state="empty" /> }
export const Expired: Story = { render: () => <Example state="expired" /> }

export const ManyPages: Story = { render: () => <Example state="many" /> }
export const NarrowViewport: Story = {
    render: () => (
        <div className="flex min-h-screen justify-center bg-background p-3">
            <iframe
                title="Facebook Page picker at 390 pixels"
                width="390"
                height="568"
                className="max-w-full border border-border"
                src="/iframe.html?id=channels-facebook-pages--many-pages&viewMode=story"
            />
        </div>
    ),
}
