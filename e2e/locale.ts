import { readFileSync } from 'node:fs'

const frenchMessages = JSON.parse(
    readFileSync(new URL('../apps/web/messages/fr.json', import.meta.url), 'utf8')
) as Record<string, string>

export function frenchTranslation(key: string): string {
    const message = frenchMessages[key]
    if (message === undefined) throw new Error(`Missing French translation: ${key}`)
    return message
}
