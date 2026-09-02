import { Alert, AlertDescription, AlertTitle } from '@herald/ui/components/alert'
import { Button } from '@herald/ui/components/button'
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from '@herald/ui/components/empty'
import { Input } from '@herald/ui/components/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@herald/ui/components/select'
import { AddIcon } from '@solar-icons/react/bold/add'
import { LinkIcon } from '@solar-icons/react/bold/link'

import { DashboardFormField } from '@/components/dashboard-form-field'
import { DashboardPageHeader } from '@/components/dashboard-page-header'
import { channelMarkerClass, channelProfileLabel } from '@/components/dashboard-publication-parts'
import { DashboardSectionHeading } from '@/components/dashboard-section-heading'
import { PublisherConnectionPanel } from '@/components/publisher-connection-panel'
import { useProjectDashboard } from '@/lib/dashboard-context'

export function ChannelManagementPage() {
    const {
        channelName,
        channelProfile,
        channels,
        connections,
        error,
        onChannelNameChange,
        onChannelProfileChange,
        onCreateChannel,
        onDisconnectPublisher,
        onStartLinkedInConnection,
        pending,
        project,
    } = useProjectDashboard()

    return (
        <main className="min-w-0 px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
            <DashboardPageHeader title="Channels">
                <p className="mt-2 text-sm text-muted-foreground">{project.name}</p>
            </DashboardPageHeader>

            {error ? (
                <Alert
                    variant="destructive"
                    className="mb-6 rounded-md border-state-failed/35 bg-state-failed/10">
                    <AlertTitle>Channel action failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}

            <section>
                <DashboardSectionHeading
                    meta={`${channels.length} channel${channels.length === 1 ? '' : 's'}`}
                    title="Project channels"
                />

                {channels.length > 0 ? (
                    <div className="mt-4 divide-y divide-border/70">
                        {channels.map(channel => (
                            <div
                                key={channel.id}
                                className="flex min-w-0 flex-col gap-3 px-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span
                                        className={`size-2.5 shrink-0 rounded-full bg-current ${channelMarkerClass(channel.profileId)}`}
                                        aria-hidden="true"
                                    />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">
                                            {channel.name}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                            {channelProfileLabel(channel.profileId)} · profile v
                                            {channel.profileVersionId.slice(0, 8)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty className="mt-4 min-h-32 bg-muted">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <LinkIcon aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>No channels in this project</EmptyTitle>
                            <EmptyDescription>
                                Create a channel before composing a publication.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
            </section>

            <form
                className="mt-7 grid gap-4 rounded-lg bg-muted p-4 shadow-surface sm:p-5 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-end"
                onSubmit={onCreateChannel}>
                <DashboardFormField label="Channel name" htmlFor="new-channel-name">
                    <Input
                        id="new-channel-name"
                        required
                        value={channelName}
                        onChange={event => onChannelNameChange(event.target.value)}
                        placeholder="Community forum"
                    />
                </DashboardFormField>
                <DashboardFormField label="Profile" htmlFor="new-channel-profile">
                    <Select
                        items={{
                            'manual-message': 'Manual message',
                            linkedin: 'LinkedIn text',
                        }}
                        value={channelProfile}
                        onValueChange={value =>
                            onChannelProfileChange(value as 'manual-message' | 'linkedin')
                        }>
                        <SelectTrigger id="new-channel-profile">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                            <SelectItem value="manual-message">Manual message</SelectItem>
                            <SelectItem value="linkedin">LinkedIn text</SelectItem>
                        </SelectContent>
                    </Select>
                </DashboardFormField>
                <Button size="lg" type="submit" className="w-full md:w-auto" disabled={pending}>
                    <AddIcon aria-hidden="true" />
                    Add channel
                </Button>
            </form>
            <p className="mt-2 px-1 text-xs text-muted-foreground sm:px-3">
                Manual message is the default profile. Connect an automatic publisher later if the
                channel supports it.
            </p>

            <div className="mt-10">
                <PublisherConnectionPanel
                    channels={channels}
                    connections={connections}
                    pending={pending}
                    onStartLinkedInConnection={onStartLinkedInConnection}
                    onDisconnectPublisher={onDisconnectPublisher}
                />
            </div>
        </main>
    )
}
