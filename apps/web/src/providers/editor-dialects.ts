import { discordEditorDialect } from './discord/editor-dialect'
const providerEditorDialects = { discord: discordEditorDialect } as const
export type ProviderEditorProfile = keyof typeof providerEditorDialects
export function providerEditorDialect(profile: string) {
    return Object.entries(providerEditorDialects).find(([id]) => id === profile)?.[1]
}
