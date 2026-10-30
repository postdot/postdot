import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { Command } from 'commander'

import manifest from '../package.json'
import { CliError, connection, output, positiveInteger, result, type Options } from './context'

export function createProgram({
    jsonErrors = false,
    writeOut = (message: string) => {
        process.stdout.write(message)
    },
} = {}) {
    const program = new Command()
        .name('postdot')
        .description('Operate a remote Postdot instance.')
        .version(manifest.version)
        .option('--base-url <origin>', 'Postdot server origin (or POSTDOT_URL)')
        .option('--timeout-ms <milliseconds>', 'Per-request deadline', positiveInteger, 30_000)
        .option('--json', 'Print one JSON result without terminal decoration')
        .exitOverride()
        .showHelpAfterError()
        .configureOutput({
            writeOut,
            writeErr: message => {
                if (!jsonErrors) process.stderr.write(message)
            },
        })

    program
        .command('projects')
        .description('Discover projects accessible to your API key.')
        .command('list')
        .description('List accessible projects.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const body = await result(connection(options).api.projects.get())
            output(
                body,
                body.projects.map(project => `${project.id}\t${project.name}`).join('\n') ||
                    'No projects.',
                options
            )
        })

    const media = program.command('media').description('Inspect and upload project media.')
    media
        .command('policy')
        .description('Inspect the server upload policy.')
        .requiredOption('--project <id>', 'Project identifier')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { project: string }>()
            const body = await result(
                connection(options)
                    .api.projects({ projectId: options.project })
                    .media['upload-policy'].get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })
    media
        .command('upload')
        .description('Reserve, upload and finalize a local file without automatic retries.')
        .requiredOption('--project <id>', 'Project identifier')
        .requiredOption('--file <path>', 'Readable, nonempty local file')
        .requiredOption('--content-type <type>', 'File MIME type accepted by the server')
        .option('--alt <text>', 'Default accessibility text')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { project: string; file: string; contentType: string; alt?: string }
            >()
            const client = connection(options)
            let size: number
            try {
                const info = await stat(options.file)
                if (!info.isFile() || info.size === 0) throw new Error('Not a nonempty file')
                size = info.size
            } catch {
                throw new CliError(
                    '--file must be a readable, nonempty regular file.',
                    'invalid_input',
                    2
                )
            }
            const route = client.api.projects({ projectId: options.project }).media
            const policy = await result(route['upload-policy'].get())
            if (
                size > policy.maxFileSize ||
                !policy.allowedContentTypes.includes(options.contentType)
            )
                throw new CliError(
                    'The file exceeds the upload policy or has an unsupported content type. Inspect media policy.',
                    'invalid_input',
                    2
                )
            const file = await openAsBlob(options.file, { type: options.contentType })
            const reservation = await result(
                route.uploads.post({
                    originalFilename: basename(options.file),
                    expectedSize: size,
                    contentType: options.contentType,
                    defaultAccessibilityText: options.alt,
                })
            )
            const checkpoint = { assetId: reservation.asset.id, intentId: reservation.intent.id }
            try {
                await result(
                    route.uploads({ intentId: checkpoint.intentId }).put(undefined, {
                        headers: { 'content-type': options.contentType },
                        fetch: { body: file },
                    })
                )
                const body = await result(
                    route.uploads({ intentId: checkpoint.intentId }).finalize.post()
                )
                if (body.status === 'failed')
                    throw new CliError(
                        'Media processing failed. Inspect the asset before retrying.',
                        'media_processing_failed'
                    )
                output(body, `Media ${checkpoint.assetId}: ${body.status}.`, options)
            } catch (error) {
                throw new CliError(
                    error instanceof CliError
                        ? error.message
                        : 'Media transfer failed. Inspect the asset before retrying.',
                    error instanceof CliError ? error.code : 'media_transfer_failed',
                    error instanceof CliError ? error.exitCode : 1,
                    {
                        ...checkpoint,
                        ...(error instanceof CliError ? { cause: error.details } : {}),
                    }
                )
            }
        })
    return program
}
