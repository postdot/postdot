import type { Command } from 'commander'

import {
    addProfile,
    assertCredentialPersistence,
    clearCredential,
    configurationDirectory,
    normalizeOrigin,
    readConfiguration,
    removeProfile,
    resolveConnection,
    saveCredential,
    selectedProfile,
    setProject,
    useProfile,
} from './configuration'
import { clientFor, output, result, type Options } from './context'
import { CliError } from './errors'
import { readSecret } from './secret-input'

export function registerConfigurationCommands(program: Command) {
    const config = program
        .command('config')
        .description('Manage local server profiles and defaults.')
    config
        .command('add <name>')
        .description('Add a named server profile; the first profile becomes active.')
        .requiredOption('--url <origin>', 'Postdot server origin')
        .option('--project <id>', 'Default project identifier')
        .action((name: string, _options, command: Command) => {
            const options = command.optsWithGlobals<Options & { url: string; project?: string }>()
            const configuration = addProfile(options, {
                name,
                origin: options.url,
                ...(options.project ? { project: options.project } : {}),
            })
            output(
                { profile: name, selected: configuration.selected === name },
                `Profile ${name} added${configuration.selected === name ? ' and selected' : ''}.`,
                options
            )
        })
    config
        .command('list')
        .description('List profiles without displaying credentials.')
        .action((_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const configuration = readConfiguration(configurationDirectory(options))
            const selected = selectedProfile(options, configuration)?.name
            output(
                { selected: selected ?? null, profiles: configuration.profiles },
                configuration.profiles
                    .map(
                        profile =>
                            `${profile.name === selected ? '*' : ' '} ${profile.name}\t${profile.origin}${profile.project ? `\t${profile.project}` : ''}`
                    )
                    .join('\n') || 'No profiles. Use config add.',
                options
            )
        })
    config
        .command('use <name>')
        .description('Select the default server profile.')
        .action((name: string, _options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            useProfile(options, name)
            output({ selected: name }, `Selected profile ${name}.`, options)
        })
    config
        .command('remove <name>')
        .description('Remove a local profile and its saved credential.')
        .action((name: string, _options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            removeProfile(options, name)
            output({ removed: name }, `Profile ${name} removed.`, options)
        })
    config
        .command('set-project [id]')
        .description('Set the selected profile default project, or clear it when omitted.')
        .action((id: string | undefined, _options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const profile = setProject(options, id)
            output(
                { profile: profile.name, project: profile.project ?? null },
                id ? `Default project: ${id}.` : 'Default project cleared.',
                options
            )
        })
    const auth = program
        .command('auth')
        .description('Store or inspect a scoped API key created in Studio.')
    auth.command('login')
        .description('Verify and save a key for the selected profile (local unencrypted file).')
        .option('--token-stdin', 'Read the key from stdin instead of a hidden terminal prompt')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options & { tokenStdin?: boolean }>()
            const profile = selectedProfile(options)
            if (!profile)
                throw new CliError(
                    'Add a profile first with config add <name> --url <origin>.',
                    'profile_required',
                    2
                )
            if (
                normalizeOrigin(options.baseUrl ?? process.env.POSTDOT_URL ?? profile.origin) !==
                profile.origin
            )
                throw new CliError(
                    'The server override differs from this profile. Add or select a profile for that server before login.',
                    'profile_origin_mismatch',
                    2
                )
            assertCredentialPersistence()
            const token = await readSecret(Boolean(options.tokenStdin), options.json)
            await result(clientFor(profile.origin, token, options.timeoutMs).api.projects.get())
            saveCredential(options, profile, token)
            output(
                { profile: profile.name, server: profile.origin, authenticated: true },
                `API key saved for ${profile.name} (${profile.origin}).`,
                options
            )
        })
    auth.command('status')
        .description('Check the effective API key against the server without displaying it.')
        .action(async (_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const settings = resolveConnection(options)
            // Capture one resolution so the reported server and credential source
            // describe the same request even if another process changes profiles.
            if (!settings.token)
                throw new CliError(
                    'No API key is available. Use auth login or POSTDOT_API_KEY.',
                    'authentication_required',
                    3
                )
            await result(
                clientFor(settings.origin, settings.token, options.timeoutMs).api.projects.get()
            )
            output(
                {
                    server: settings.origin,
                    profile: settings.profile ?? null,
                    credentialSource: settings.credentialSource,
                    project: settings.project ?? null,
                    authenticated: true,
                },
                `API key accepted by ${settings.origin} (${settings.credentialSource}).`,
                options
            )
        })
    auth.command('logout')
        .description(
            'Remove the selected profile local key; server keys and environment variables stay active.'
        )
        .action((_options, command: Command) => {
            const options = command.optsWithGlobals<Options>()
            const cleared = clearCredential(options)
            const environmentCredentialPresent = Boolean(process.env.POSTDOT_API_KEY)
            output(
                { ...cleared, environmentCredentialPresent },
                `${cleared.removed ? 'Removed the local key' : 'No local key was saved'} for ${cleared.profile}.${environmentCredentialPresent ? ' POSTDOT_API_KEY is still set.' : ''}`,
                options
            )
        })
}
