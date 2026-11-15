import type { Command } from 'commander'

import {
    connection,
    output,
    positiveInteger,
    projectConnection,
    resolveWebsiteOption,
    result,
    uploadIdentityImage,
    type Options,
} from './context'

export function registerDiscoveryCommands(program: Command) {
    const projects = program
        .command('projects')
        .description('Discover and configure projects accessible to your API key.')
    projects
        .command('list')
        .description('List accessible projects.')
        .option('--include-archived', 'Include archived projects')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { includeArchived?: boolean }>()
            const body = await result(
                connection(options).api.projects.get({
                    query: { includeArchived: options.includeArchived },
                })
            )
            output(
                body,
                body.projects.map(project => `${project.id}\t${project.name}`).join('\n') ||
                    'No projects.',
                options
            )
        })
    projects
        .command('set-website')
        .description(
            'Set or clear the project website URL and resolve its favicon when no custom image is set.'
        )
        .option('--project <id>', 'Project identifier (or profile default)')
        .option('--url <url>', 'Website HTTP(S) URL')
        .option('--clear', 'Clear the website URL')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { url?: string; clear?: boolean }>()
            const websiteUrl = resolveWebsiteOption(options)
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api.projects({ projectId }).website.put({ websiteUrl })
            )
            const human = websiteUrl
                ? `Project ${body.project.id} website: ${body.project.websiteUrl ?? websiteUrl}${body.warning ? ` (${body.warning})` : ''}.`
                : `Cleared website for project ${body.project.id}.`
            output(body, human, options)
        })
    projects
        .command('upload-image')
        .description('Upload a local image file as the project identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--file <path>', 'Readable, nonempty local image file (maximum 2 MB)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { file: string }>()
            const { projectId } = projectConnection(options)
            const body = await uploadIdentityImage<{
                project: { id: string; imageUrl?: string | null }
            }>(options, `/api/projects/${encodeURIComponent(projectId)}/image`, options.file)
            output(
                body,
                `Uploaded image for project ${body.project.id}: ${body.project.imageUrl ?? ''}.`,
                options
            )
        })
    projects
        .command('import-image-url')
        .description('Set the project identity image from a remote HTTP(S) image URL.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--url <url>', 'Remote HTTP(S) image URL')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { url: string }>()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api.projects({ projectId }).image.url.post({ url: options.url })
            )
            output(
                body,
                `Imported image for project ${body.project.id}: ${body.project.imageUrl ?? ''}.`,
                options
            )
        })
    projects
        .command('use-website-icon')
        .description('Resolve and use the project website favicon as its identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(client.api.projects({ projectId }).image.favicon.post())
            output(
                body,
                `Updated project ${body.project.id} image from website icon: ${body.project.imageUrl ?? ''}.`,
                options
            )
        })
    projects
        .command('remove-image')
        .description('Remove the project identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(client.api.projects({ projectId }).image.delete())
            output(body, `Removed image for project ${body.project.id}.`, options)
        })

    const channels = program
        .command('channels')
        .description('Discover project destinations and their content contracts.')
    channels
        .command('list')
        .description('List the project channels.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(client.api.projects({ projectId }).channels.get())
            output(
                body,
                body.channels.map(channel => `${channel.id}\t${channel.name}`).join('\n') ||
                    'No channels.',
                options
            )
        })
    channels
        .command('profile')
        .description('Inspect the active content contract and destination capabilities.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { channel: string }>()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .channels({ channelId: options.channel })
                    .profile.get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })
    channels
        .command('set-website')
        .description(
            'Set or clear a channel website URL and resolve its favicon when no custom image is set.'
        )
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .option('--url <url>', 'Website HTTP(S) URL')
        .option('--clear', 'Clear the website URL')
        .option('--expected-revision <revision>', 'Expected channel revision', positiveInteger)
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & {
                    channel: string
                    url?: string
                    clear?: boolean
                    expectedRevision?: number
                }
            >()
            const websiteUrl = resolveWebsiteOption(options)
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .channels({ channelId: options.channel })
                    .website.put({
                        websiteUrl,
                        ...(options.expectedRevision !== undefined
                            ? { expectedRevision: options.expectedRevision }
                            : {}),
                    })
            )
            const human = websiteUrl
                ? `Channel ${body.channel.id} website: ${body.channel.websiteUrl ?? websiteUrl}${body.warning ? ` (${body.warning})` : ''}.`
                : `Cleared website for channel ${body.channel.id}.`
            output(body, human, options)
        })
    channels
        .command('upload-image')
        .description('Upload a local image file as a channel identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .requiredOption('--file <path>', 'Readable, nonempty local image file (maximum 2 MB)')
        .option('--expected-revision <revision>', 'Expected channel revision', positiveInteger)
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { channel: string; file: string; expectedRevision?: number }
            >()
            const { projectId } = projectConnection(options)
            const query =
                options.expectedRevision !== undefined
                    ? `?expectedRevision=${options.expectedRevision}`
                    : ''
            const body = await uploadIdentityImage<{
                channel: { id: string; imageUrl?: string | null }
            }>(
                options,
                `/api/projects/${encodeURIComponent(projectId)}/channels/${encodeURIComponent(options.channel)}/image${query}`,
                options.file
            )
            output(
                body,
                `Uploaded image for channel ${body.channel.id}: ${body.channel.imageUrl ?? ''}.`,
                options
            )
        })
    channels
        .command('import-image-url')
        .description('Set a channel identity image from a remote HTTP(S) image URL.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .requiredOption('--url <url>', 'Remote HTTP(S) image URL')
        .option('--expected-revision <revision>', 'Expected channel revision', positiveInteger)
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { channel: string; url: string; expectedRevision?: number }
            >()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .channels({ channelId: options.channel })
                    .image.url.post({
                        url: options.url,
                        ...(options.expectedRevision !== undefined
                            ? { expectedRevision: options.expectedRevision }
                            : {}),
                    })
            )
            output(
                body,
                `Imported image for channel ${body.channel.id}: ${body.channel.imageUrl ?? ''}.`,
                options
            )
        })
    channels
        .command('use-website-icon')
        .description('Resolve and use the channel website favicon as its identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .option('--expected-revision <revision>', 'Expected channel revision', positiveInteger)
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { channel: string; expectedRevision?: number }
            >()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .channels({ channelId: options.channel })
                    .image.favicon.post(undefined, {
                        query: {
                            ...(options.expectedRevision !== undefined
                                ? { expectedRevision: options.expectedRevision }
                                : {}),
                        },
                    })
            )
            output(
                body,
                `Updated channel ${body.channel.id} image from website icon: ${body.channel.imageUrl ?? ''}.`,
                options
            )
        })
    channels
        .command('remove-image')
        .description('Remove a channel identity image.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--channel <id>', 'Channel identifier')
        .option('--expected-revision <revision>', 'Expected channel revision', positiveInteger)
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { channel: string; expectedRevision?: number }
            >()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .channels({ channelId: options.channel })
                    .image.delete(undefined, {
                        query: {
                            ...(options.expectedRevision !== undefined
                                ? { expectedRevision: options.expectedRevision }
                                : {}),
                        },
                    })
            )
            output(body, `Removed image for channel ${body.channel.id}.`, options)
        })

    program
        .command('publishers')
        .description('Inspect project publisher connections.')
        .command('list')
        .description('Inspect publisher connections and configuration readiness.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(client.api.projects({ projectId }).publishers.get())
            output(body, JSON.stringify(body, null, 2), options)
        })
}
