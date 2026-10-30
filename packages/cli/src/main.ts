import { CommanderError } from 'commander'

import { CliError } from './context'
import { createProgram } from './program'

try {
    await createProgram({ jsonErrors: process.argv.includes('--json') }).parseAsync(process.argv)
} catch (error) {
    if (error instanceof CommanderError) {
        if (error.exitCode !== 0 && process.argv.includes('--json'))
            process.stderr.write(
                `${JSON.stringify({ error: { code: 'invalid_input', message: error.message } })}\n`
            )
        process.exitCode = error.exitCode === 0 ? 0 : 2
    } else {
        const failure =
            error instanceof CliError
                ? error
                : new CliError('The command could not be completed.', 'command_failed')
        const message = process.argv.includes('--json')
            ? JSON.stringify({
                  error: {
                      code: failure.code,
                      message: failure.message,
                      ...(failure.details === undefined ? {} : { details: failure.details }),
                  },
              })
            : failure.message
        process.stderr.write(`${message}\n`)
        process.exitCode = failure.exitCode
    }
}
