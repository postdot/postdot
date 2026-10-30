import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import type { Command } from 'commander'

import { CliError, output, projectConnection, result, type Options } from './context'

export function registerMediaCommands(program: Command) {
    const media = program.command('media').description('Inspect and upload project media.')
    media
        .command('policy')
        .description('Inspect the server upload policy.')
        .option('--project <id>', 'Project identifier (or POSTDOT_PROJECT / profile default)')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const { client, projectId } = projectConnection(options)
            const body = await result(
                client.api.projects({ projectId }).media['upload-policy'].get()
            )
            output(body, JSON.stringify(body, null, 2), options)
        })
    media
        .command('upload')
        .description('Reserve, upload and finalize a local file without automatic retries.')
        .option('--project <id>', 'Project identifier (or POSTDOT_PROJECT / profile default)')
        .requiredOption('--file <path>', 'Readable, nonempty local file')
        .requiredOption('--content-type <type>', 'File MIME type accepted by the server')
        .option('--alt <text>', 'Default accessibility text')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<
                Options & { file: string; contentType: string; alt?: string }
            >()
            const { client, projectId } = projectConnection(options)
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
            const route = client.api.projects({ projectId }).media
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
    for (const action of ['list', 'show', 'finalize', 'import-url'] as const) {
        const command = media
            .command(action)
            .option('--project <id>', 'Project identifier (or profile default)')
        if (action === 'list')
            command
                .description('List one media page with its continuation cursor.')
                .option('--cursor <cursor>', 'Next-page cursor')
        if (action === 'show')
            command
                .description('Inspect one media asset.')
                .requiredOption('--asset <id>', 'Asset identifier')
        if (action === 'finalize')
            command
                .description('Explicitly finalize a known upload intent.')
                .requiredOption('--intent <id>', 'Upload intent identifier')
        if (action === 'import-url')
            command
                .description('Import media from a URL once, without polling.')
                .requiredOption('--url <url>', 'Media source URL')
        command.action(async (_options, current: Command) => {
            const options = current.optsWithGlobals<
                Options & { cursor?: string; asset: string; intent: string; url: string }
            >()
            const { client, projectId } = projectConnection(options)
            const route = client.api.projects({ projectId }).media
            const body =
                action === 'list'
                    ? await result(route.get({ query: { limit: 100, cursor: options.cursor } }))
                    : action === 'show'
                      ? await result(route({ assetId: options.asset }).get())
                      : action === 'finalize'
                        ? await result(route.uploads({ intentId: options.intent }).finalize.post())
                        : await result(route.imports.url.post({ url: options.url }))
            if ('status' in body && body.status === 'failed')
                throw new CliError(
                    'Media verification failed. Inspect the asset before using it.',
                    'media_processing_failed',
                    1,
                    {
                        assetId: body.media.asset.id,
                        ...(options.intent ? { intentId: options.intent } : {}),
                    }
                )
            output(body, JSON.stringify(body, null, 2), options)
        })
    }
}
