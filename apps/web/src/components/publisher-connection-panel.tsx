import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { AddIcon } from '@solar-icons/react/bold/add'
import { CheckReadIcon } from '@solar-icons/react/bold/check-read'
import { LinkIcon } from '@solar-icons/react/bold/link'

import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import type { Channel, PublisherConnection } from '@/lib/api'

interface PublisherConnectionPanelProps {
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly pending: boolean
    readonly onStartLinkedInConnection: (channelId: string) => Promise<void>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
}

export function PublisherConnectionPanel({
    channels,
    connections,
    pending,
    onStartLinkedInConnection,
    onDisconnectPublisher,
}: PublisherConnectionPanelProps) {
    const connectionsByChannel = new Map(
        connections.map(connection => [connection.channelId, connection])
    )

    return (
        <section id="publisher-connections" className="pt-1">
            <DashboardSectionHeading
                description="Automatic delivery requires a connection on supported channels."
                meta={`${connections.length} connected`}
                title="Publisher connections"
            />

            <div className="mt-4 divide-y divide-border/70">
                {channels.length === 0 ? (
                    <Empty className="min-h-32 bg-muted">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <LinkIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>No publisher connections</EmptyTitle>
                            <EmptyDescription>
                                Create a channel before configuring an automatic destination.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    channels.map(channel => {
                        const connection = connectionsByChannel.get(channel.id)

                        return (
                            <article
                                key={channel.id}
                                className="flex flex-col gap-4 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium">
                                        {connection === undefined ? (
                                            <AddIcon aria-hidden="true" className="text-primary" />
                                        ) : (
                                            <CheckReadIcon
                                                aria-hidden="true"
                                                className="text-state-published"
                                            />
                                        )}
                                        <span>{channel.name}</span>
                                    </div>
                                    {channel.profileId !== 'linkedin' ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            Manual publication only for this channel profile.
                                        </p>
                                    ) : connection === undefined ? (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            No automatic publisher is connected.
                                        </p>
                                    ) : (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            LinkedIn member ·{' '}
                                            {connection.externalAccountName ??
                                                connection.externalAccountId}
                                        </p>
                                    )}
                                    {connection !== undefined && connection.state !== 'active' ? (
                                        <p className="mt-1 text-sm text-destructive">
                                            Reconnection required before automatic publishing can
                                            resume.
                                        </p>
                                    ) : null}
                                </div>

                                {channel.profileId === 'linkedin' && connection === undefined ? (
                                    <div className="mt-4 grid gap-3 sm:mt-0 sm:min-w-72">
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void onStartLinkedInConnection(channel.id)
                                            }
                                            disabled={pending}>
                                            <AddIcon aria-hidden="true" />
                                            Connect LinkedIn
                                        </Button>
                                    </div>
                                ) : channel.profileId === 'linkedin' && connection !== undefined ? (
                                    <Button
                                        className="mt-4 sm:mt-0"
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void onDisconnectPublisher(channel.id)}
                                        disabled={pending}>
                                        Disconnect publisher
                                    </Button>
                                ) : null}
                            </article>
                        )
                    })
                )}
            </div>
        </section>
    )
}
