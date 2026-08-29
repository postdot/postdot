import { AddCircleIcon } from '@solar-icons/react/linear/add-circle'
import { CheckCircleIcon } from '@solar-icons/react/linear/check-circle'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { Channel, LinkedAccount, PublisherConnection } from '@/lib/api'

interface PublisherConnectionPanelProps {
    readonly channels: readonly Channel[]
    readonly connections: readonly PublisherConnection[]
    readonly linkedAccounts: readonly LinkedAccount[]
    readonly pending: boolean
    readonly onStartLinkedInConnection: (channelId: string) => Promise<void>
    readonly onConnectLinkedInPublisher: (channelId: string, accountId: string) => Promise<void>
    readonly onDisconnectPublisher: (channelId: string) => Promise<void>
}

export function PublisherConnectionPanel({
    channels,
    connections,
    linkedAccounts,
    pending,
    onStartLinkedInConnection,
    onConnectLinkedInPublisher,
    onDisconnectPublisher,
}: PublisherConnectionPanelProps) {
    const linkedinAccounts = linkedAccounts.filter(account => account.providerId === 'linkedin')
    const [selectedAccountByChannel, setSelectedAccountByChannel] = useState<
        Record<string, string>
    >({})
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
                        const account =
                            connection === undefined
                                ? undefined
                                : linkedAccounts.find(item => item.id === connection.accountId)
                        const selectedAccountId =
                            selectedAccountByChannel[channel.id] ?? linkedinAccounts[0]?.id ?? ''

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
                                            LinkedIn member
                                            {account === undefined
                                                ? ''
                                                : ` · account ${account.id}`}
                                        </p>
                                    )}
                                </div>

                                {connection === undefined ? (
                                    <div className="mt-4 grid gap-3 sm:mt-0 sm:min-w-72">
                                        {linkedinAccounts.length > 0 ? (
                                            <label className="grid gap-2 text-sm font-medium">
                                                LinkedIn account
                                                <select
                                                    aria-label={`Select a LinkedIn account for ${channel.name}`}
                                                    value={selectedAccountId}
                                                    onChange={event =>
                                                        setSelectedAccountByChannel(current => ({
                                                            ...current,
                                                            [channel.id]: event.target.value,
                                                        }))
                                                    }
                                                    disabled={pending}
                                                    className="h-9 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus:border-ring focus:ring-3 focus:ring-ring/20">
                                                    {linkedinAccounts.map(linkedAccount => (
                                                        <option
                                                            key={linkedAccount.id}
                                                            value={linkedAccount.id}>
                                                            {linkedAccount.id}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        ) : null}
                                        {linkedinAccounts.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() =>
                                                        void onConnectLinkedInPublisher(
                                                            channel.id,
                                                            selectedAccountId
                                                        )
                                                    }
                                                    disabled={pending || selectedAccountId === ''}>
                                                    <CheckCircleIcon aria-hidden="true" />
                                                    Bind account
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        void onStartLinkedInConnection(channel.id)
                                                    }
                                                    disabled={pending}>
                                                    <AddCircleIcon aria-hidden="true" />
                                                    Connect another
                                                </Button>
                                            </div>
                                        ) : (
                                            <Button
                                                size="sm"
                                                onClick={() =>
                                                    void onStartLinkedInConnection(channel.id)
                                                }
                                                disabled={pending}>
                                                <AddCircleIcon aria-hidden="true" />
                                                Connect LinkedIn
                                            </Button>
                                        )}
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
