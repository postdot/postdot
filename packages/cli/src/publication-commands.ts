import { Option, type Command } from 'commander'

import {
    CliError,
    output,
    positiveInteger,
    projectConnection,
    result,
    type Options,
} from './context'
import { commaSeparatedIds, nonnegativeInteger, readJsonObject } from './input'

type PublicationOptions = Options & { publication: string }

export function registerPublicationCommands(program: Command) {
    program
        .command('posts')
        .description('Create source posts and destination drafts.')
        .command('create')
        .description('Create a source post and its destination publications from JSON.')
        .option('--project <id>', 'Project identifier (or profile default)')
        .requiredOption('--input <file|->', 'JSON object from a file or stdin, at most 1 MiB')
        .addHelpText(
            'after',
            '\nExample:\n  postdot posts create --input post.json --json\nInspect channels profile before preparing destination content.'
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { input: string }>()
            const { client, projectId } = projectConnection(options)
            const route = client.api.projects({ projectId }).posts
            const input = await readJsonObject<Parameters<typeof route.post>[0]>(options.input)
            const body = await result(route.post(input))
            output(
                body,
                `Post ${body.post.id} created with ${body.publications.length} publications.`,
                options
            )
        })

    const publications = program
        .command('publications')
        .description('Inspect, prepare and control destination publications.')
    const scoped = (name: string, description: string) =>
        publications
            .command(name)
            .description(description)
            .option('--project <id>', 'Project identifier (or profile default)')
    const single = (name: string, description: string) =>
        scoped(name, description).requiredOption('--publication <id>', 'Publication identifier')

    scoped('list', 'List one publication page with its continuation cursor.')
        .option('--cursor <cursor>', 'Next-page cursor')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { cursor?: string }>()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .publications.get({ query: { limit: 100, cursor: options.cursor } })
            )
            output(body, JSON.stringify(body, null, 2), options)
        })
    single(
        'show',
        'Inspect the publication, draft revision and source/destination context.'
    ).action(async (_options, command: Command) => {
        const options = command.optsWithGlobals<PublicationOptions>()
        const { client, projectId } = projectConnection(options)
        const body = await result(
            client.api
                .projects({ projectId })
                .publications({ publicationId: options.publication })
                .editor.get()
        )
        output(body, JSON.stringify(body, null, 2), options)
    })
    single('save', 'Save a destination draft using its expected revision.')
        .requiredOption(
            '--input <file|->',
            'JSON object including expectedRevision and targetContent'
        )
        .addHelpText(
            'after',
            '\nRead publications show first; use its editor.draft.revision as expectedRevision.\nA revision conflict requires inspection rather than automatic retry.'
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<PublicationOptions & { input: string }>()
            const { client, projectId } = projectConnection(options)
            const route = client.api
                .projects({ projectId })
                .publications({ publicationId: options.publication }).draft
            const input = await readJsonObject<Parameters<typeof route.patch>[0]>(options.input)
            const body = await result(route.patch(input))
            output(body, `Draft saved at revision ${body.editor.draft.revision}.`, options)
        })
    single('promote', 'Promote the expected draft revision and schedule it.')
        .requiredOption('--expected-revision <n>', 'Expected draft revision', positiveInteger)
        .requiredOption(
            '--at <epoch-ms>',
            'Scheduled Unix time in milliseconds',
            nonnegativeInteger
        )
        .option(
            '--cadence-confirmation <value>',
            'Explicit confirmation returned by a cadence conflict'
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                PublicationOptions & {
                    expectedRevision: number
                    at: number
                    cadenceConfirmation?: string
                }
            >()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .publications({ publicationId: options.publication })
                    .draft.promote.post({
                        expectedRevision: options.expectedRevision,
                        scheduledAt: options.at,
                        cadenceConfirmation: options.cadenceConfirmation,
                    })
            )
            output(body, 'Draft promoted and scheduled.', options)
        })
    for (const action of ['schedule', 'cancel'] as const) {
        const command = scoped(
            action,
            action === 'schedule'
                ? 'Reschedule selected publications.'
                : 'Cancel selected pending publications.'
        ).requiredOption(
            '--publications <ids>',
            'Comma-separated publication identifiers',
            commaSeparatedIds
        )
        if (action === 'schedule')
            command
                .requiredOption(
                    '--at <epoch-ms>',
                    'Scheduled Unix time in milliseconds',
                    nonnegativeInteger
                )
                .option(
                    '--cadence-confirmation <value>',
                    'Explicit confirmation returned by a cadence conflict'
                )
        command.action(async (_options, current: Command) => {
            const options = current.optsWithGlobals<
                Options & { publications: string[]; at: number; cadenceConfirmation?: string }
            >()
            const { client, projectId } = projectConnection(options)
            const route = client.api.projects({ projectId }).publications
            const body =
                action === 'schedule'
                    ? await result(
                          route.schedule.patch({
                              publicationIds: options.publications,
                              scheduledAt: options.at,
                              cadenceConfirmation: options.cadenceConfirmation,
                          })
                      )
                    : await result(route.cancel.patch({ publicationIds: options.publications }))
            output(
                body,
                action === 'schedule' ? 'Publications rescheduled.' : 'Publications cancelled.',
                options
            )
        })
    }
    single(
        'retry',
        'Request a retry when the server permits it; uncertain delivery requires reconciliation.'
    )
        .option(
            '--cadence-confirmation <value>',
            'Explicit confirmation returned by a cadence conflict'
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                PublicationOptions & { cadenceConfirmation?: string }
            >()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .publications({ publicationId: options.publication })
                    .retry.post({ cadenceConfirmation: options.cadenceConfirmation })
            )
            output(body, 'Publication retry requested.', options)
        })
    scoped('due', 'List manual publications awaiting publication.').action(
        async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(client.api.projects({ projectId }).publications.due.get())
            output(body, JSON.stringify(body, null, 2), options)
        }
    )
    single(
        'publish',
        'Mark a manual publication as published; this does not send content to a provider.'
    )
        .option('--external-url <url>', 'URL of the published content')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<PublicationOptions & { externalUrl?: string }>()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api
                    .projects({ projectId })
                    .publications({ publicationId: options.publication })
                    .publish.post({ externalUrl: options.externalUrl })
            )
            output(body, 'Manual publication marked as published.', options)
        })
    single(
        'move',
        'Move future work using the current revisions and destination from publications show.'
    )
        .requiredOption(
            '--input <file|->',
            'JSON object with the new destination and expected revisions'
        )
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<PublicationOptions & { input: string }>()
            const { client, projectId } = projectConnection(options)
            const route = client.api
                .projects({ projectId })
                .publications({ publicationId: options.publication }).move
            const input = await readJsonObject<Parameters<typeof route.post>[0]>(options.input)
            const body = await result(route.post(input))
            output(body, JSON.stringify(body, null, 2), options)
        })
    for (const action of ['cadence', 'override-cadence'] as const) {
        const command = single(
            action,
            action === 'cadence'
                ? 'Inspect dispatch timing, or null when no timing applies.'
                : 'Explicitly override one interval using the server confirmation.'
        )
        if (action === 'override-cadence')
            command.requiredOption(
                '--confirmation <value>',
                'Confirmation returned by cadence inspection'
            )
        command.action(async (_options, current: Command) => {
            const options = current.optsWithGlobals<PublicationOptions & { confirmation: string }>()
            const { client, projectId } = projectConnection(options)
            const route = client.api
                .projects({ projectId })
                .publications({ publicationId: options.publication })
            const body =
                action === 'cadence'
                    ? await result(route.cadence.get(), true)
                    : await result(
                          route['cadence-override'].post({ confirmation: options.confirmation }),
                          true
                      )
            output(body, JSON.stringify(body, null, 2), options)
        })
    }
    single('reconcile', 'Record an explicitly verified outcome after uncertain delivery.')
        .addOption(
            new Option('--resolution <outcome>', 'Verified delivery outcome')
                .choices(['published', 'failed'])
                .makeOptionMandatory()
        )
        .addOption(
            new Option(
                '--external-id <id>',
                'Required when the verified outcome is published'
            ).conflicts('errorMessage')
        )
        .option('--external-url <url>', 'URL of the verified published content')
        .option('--error-message <text>', 'Required when the verified outcome is failed')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                PublicationOptions & {
                    resolution: 'published' | 'failed'
                    externalId?: string
                    externalUrl?: string
                    errorMessage?: string
                }
            >()
            const input =
                options.resolution === 'published'
                    ? {
                          resolution: 'published' as const,
                          externalId: requiredValue(options.externalId, '--external-id'),
                          externalUrl: options.externalUrl,
                      }
                    : {
                          resolution: 'failed' as const,
                          errorMessage: requiredValue(options.errorMessage, '--error-message'),
                      }
            const { client, projectId } = projectConnection(options)
            const route = client.api
                .projects({ projectId })
                .publications({ publicationId: options.publication }).reconcile
            const body = await result(route.post(input))
            output(body, `Publication reconciled as ${options.resolution}.`, options)
        })
}

function requiredValue(value: string | undefined, option: string) {
    if (!value) throw new CliError(`${option} is required for this resolution.`, 'invalid_input', 2)
    return value
}
