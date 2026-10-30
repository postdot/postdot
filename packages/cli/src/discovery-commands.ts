import type { Command } from 'commander'

import { connection, output, projectConnection, result, type Options } from './context'

export function registerDiscoveryCommands(program: Command) {
    program
        .command('projects')
        .description('Discover projects accessible to your API key.')
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
