import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

import { CliError } from './errors'

export async function readSecret(fromStdin: boolean, json: boolean | undefined) {
    let value: string
    if (fromStdin) {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of process.stdin) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += bytes.length
            if (size > 16_384)
                throw new CliError('The API key input exceeds 16 KiB.', 'invalid_input', 2)
            chunks.push(bytes)
        }
        value = Buffer.concat(chunks).toString('utf8')
    } else {
        if (json || !process.stdin.isTTY || !process.stderr.isTTY)
            throw new CliError(
                'Pass the key through --token-stdin, or use POSTDOT_API_KEY directly for automation.',
                'interactive_input_required',
                2
            )
        // Readline owns editing and raw-mode restoration. Its output is muted so
        // typed/pasted credentials never reach either terminal output stream.
        const muted = new Writable({
            write(_chunk, _encoding, done) {
                done()
            },
        })
        const prompt = createInterface({
            input: process.stdin,
            output: muted,
            terminal: true,
            historySize: 0,
        })
        process.stderr.write('API key (hidden): ')
        try {
            value = await new Promise<string>((resolve, reject) => {
                prompt.once('SIGINT', () =>
                    reject(new CliError('Login cancelled.', 'cancelled', 130))
                )
                prompt.once('close', () =>
                    reject(new CliError('No API key was entered.', 'invalid_input', 2))
                )
                prompt.question('', resolve)
            })
        } finally {
            prompt.close()
            process.stderr.write('\n')
        }
    }
    const token = value.trim()
    if (!token || /\s/.test(token) || Buffer.byteLength(token) > 16_384)
        throw new CliError('Provide one nonempty API key without whitespace.', 'invalid_input', 2)
    return token
}
