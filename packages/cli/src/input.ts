import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import { InvalidArgumentError } from 'commander'

import { CliError } from './errors'

const maximumInputBytes = 1_048_576

export function nonnegativeInteger(value: string) {
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new InvalidArgumentError('Expected a nonnegative safe integer.')
    return Number(value)
}
export function commaSeparatedIds(value: string) {
    const ids = value.split(',').map(id => id.trim())
    if (ids.some(id => !id))
        throw new InvalidArgumentError('Provide comma-separated identifiers without empty entries.')
    return ids
}

export async function readJsonObject<T>(path: string): Promise<T> {
    let text: string
    try {
        if (path !== '-') {
            const info = await stat(path)
            if (!info.isFile() || info.size > maximumInputBytes)
                throw new Error('Invalid input file')
        }
        const input = path === '-' ? process.stdin : createReadStream(path)
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of input) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += bytes.length
            if (size > maximumInputBytes) throw new Error('Input too large')
            chunks.push(bytes)
        }
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } catch {
        throw new CliError(
            'Cannot read --input. Use a readable UTF-8 JSON file or stdin (-), at most 1 MiB.',
            'invalid_input',
            2
        )
    }
    let value: unknown
    try {
        value = JSON.parse(text) as unknown
    } catch {
        throw new CliError('--input must contain valid JSON.', 'invalid_input', 2)
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new CliError('--input must contain a JSON object.', 'invalid_input', 2)
    // The only untrusted JSON assertion: request types come from the selected
    // Treaty method; the server's Elysia schema remains authoritative.
    return value as T
}
