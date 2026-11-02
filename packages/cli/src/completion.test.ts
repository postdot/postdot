import { expect, test } from 'bun:test'

import { Command, Option } from 'commander'

import { completionCandidates, completionScript } from './completion'
import { createProgram } from './program'

const complete = (...words: string[]) =>
    completionCandidates(createProgram(), ['postdot', ...words], words.length)

test('completes the real command tree and inherited options without invoking handlers', () => {
    expect(complete('pub')).toEqual(['publications', 'publishers'])
    expect(complete('publications', 's')).toEqual(['save', 'schedule', 'show'])
    expect(complete('media', 'upload', '--p')).toEqual(['--profile', '--project'])
    expect(complete('media', 'upload', '--')).toContain('--file')
    expect(complete('publications', 'show', '--')).not.toContain('--file')
    expect(complete('config', 'add', 'work', '--')).toContain('--url')
    expect(complete('help', 'publications', 's')).toEqual(['save', 'schedule', 'show'])
    expect(complete('')).not.toContain('__complete')
})

test('respects values, equals assignments, cursor position and the option terminator', () => {
    expect(complete('--base-url', 'https://example.test', 'publications', 'sh')).toEqual(['show'])
    expect(complete('--base-url=https://example.test', 'projects', 'l')).toEqual(['list'])
    expect(
        complete('--base-url', 'https', ':', '//example.test', ':', '3000', 'projects', 'l')
    ).toEqual(['list'])
    expect(complete('--profile', 'publications', 'proj')).toEqual(['projects'])
    expect(complete('--profile', 'pub')).toEqual([])
    expect(complete('publications', 'reconcile', '--resolution', 'p')).toEqual(['published'])
    expect(complete('publications', 'reconcile', '--resolution=p')).toEqual([
        '--resolution=published',
    ])
    expect(complete('completion', 'z')).toEqual(['zsh'])
    expect(complete('--', 'pub')).toEqual([])
    expect(complete('unknown', '')).toEqual([])
    expect(
        completionCandidates(createProgram(), ['postdot', 'pub', 'upload', '--bad'], 1)
    ).toContain('publications')
})

test('follows new declarations and aliases instead of maintaining a second command inventory', () => {
    const program = new Command('postdot')
    const child = program
        .command('fresh')
        .alias('f')
        .action(() => {
            throw new Error('must not execute')
        })
    child.command('inspect').addOption(new Option('--choice <name>').choices(['first', 'second']))
    expect(completionCandidates(program, ['postdot', ''], 1)).toContain('fresh')
    expect(completionCandidates(program, ['postdot', 'f', 'in'], 2)).toEqual(['inspect'])
    expect(
        completionCandidates(program, ['postdot', 'fresh', 'inspect', '--choice', 's'], 4)
    ).toEqual(['second'])
})

test('completion generation supports JSON and rejects unsupported shells', async () => {
    let output = ''
    await createProgram({
        writeOut: value => {
            output += value
        },
    }).parseAsync(['completion', 'bash', '--json'], { from: 'user' })
    expect(JSON.parse(output)).toMatchObject({
        shell: 'bash',
        script: expect.stringContaining('COMPREPLY'),
    })
    await expect(
        createProgram({ jsonErrors: true }).parseAsync(['completion', 'powershell'], {
            from: 'user',
        })
    ).rejects.toMatchObject({ code: 'commander.invalidArgument' })
    for (const shell of ['bash', 'zsh', 'fish'] as const) {
        const script = completionScript(shell, ["/runtime user's/bin", '/CLI path/cli.js'])
        expect(script).not.toContain('eval ')
        expect(script).toContain('__complete')
    }
})
