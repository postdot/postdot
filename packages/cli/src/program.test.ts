import { expect, test } from 'bun:test'

import { createProgram } from './program'

test('help is available without a connection, credential or network request', async () => {
    let help = ''
    const program = createProgram({
        writeOut: value => {
            help += value
        },
    })
    await expect(
        program.parseAsync(['media', 'upload', '--help'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed', exitCode: 0 })
    expect(help).toContain('--content-type <type>')
    expect(help).toContain('--project <id>')
})

test('invalid options fail before attempting a remote operation', async () => {
    const program = createProgram({ jsonErrors: true })
    await expect(
        program.parseAsync(['--timeout-ms', '12ms', 'projects', 'list'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' })
    await expect(
        createProgram({ jsonErrors: true }).parseAsync(['media', 'upload', '--project', 'p'], {
            from: 'user',
        })
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' })
})
