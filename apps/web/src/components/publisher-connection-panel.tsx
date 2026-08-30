import { AddCircleIcon } from '@solar-icons/react/linear/add-circle'
import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'

import { Button } from '@/components/ui/button'
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
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                    Automatic destinations
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                    Publisher connections
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Connect a LinkedIn member account to a channel when scheduled work should be
                    published automatically.
                </p>
            </div>

            <div className="mt-6 space-y-3">
                {channels.length === 0 ? (
                    <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        Create a channel before configuring an automatic destination.
                    </p>
                ) : (
                    channels.map(channel => {
                        const connection = connectionsByChannel.get(channel.id)

                        return (
                            <article
                                key={channel.id}
                                className="rounded-xl border p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        {connection === undefined ? (
                                            <AddCircleIcon aria-hidden="true" />
                                        ) : (
                                            <CheckCircleIcon aria-hidden="true" />
                                        )}
                                        <span>{channel.name}</span>
                                    </div>
                                    {connection === undefined ? (
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

                                {connection === undefined ? (
                                    <div className="mt-4 grid gap-3 sm:mt-0 sm:min-w-72">
                                        <Button
                                            size="sm"
                                            onClick={() =>
                                                void onStartLinkedInConnection(channel.id)
                                            }
                                            disabled={pending}>
                                            <AddCircleIcon aria-hidden="true" />
                                            Connect LinkedIn
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        className="mt-4 sm:mt-0"
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => void onDisconnectPublisher(channel.id)}
                                        disabled={pending}>
                                        Disconnect publisher
                                    </Button>
                                )}
                            </article>
                        )
                    })
                )}
            </div>
        </section>
    )
}
