import { Command } from 'commander'

import manifest from '../../../integrations/cli/package.json'
import { registerConfigurationCommands } from './configuration-commands'
import { positiveInteger } from './context'
import { registerDiscoveryCommands } from './discovery-commands'
import { registerMediaCommands } from './media-commands'
import { registerPublicationCommands } from './publication-commands'

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
        .option('--profile <name>', 'Saved connection profile (or POSTDOT_PROFILE)')
        .option('--config-dir <path>', 'Absolute configuration directory (or POSTDOT_CONFIG_DIR)')
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

    registerDiscoveryCommands(program)
    registerPublicationCommands(program)
    registerMediaCommands(program)
    registerConfigurationCommands(program)
    return program
}
