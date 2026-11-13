import * as m from '@/paraglide/messages.js'

import type { ProviderFieldDefinition } from './contract'

export function threadField(
    provider: 'x' | 'bluesky' | 'mastodon',
    revision: string
): ProviderFieldDefinition {
    return {
        kind: `provider:${provider}:thread`,
        path: '/thread',
        inlineFields: provider === 'mastodon' ? ['/visibility'] : [],
        label: locale => m.thread_title({}, { locale }),
        supports(profile) {
            if (!profile || typeof profile !== 'object' || !('execution' in profile)) return false
            const execution = profile.execution as Record<string, unknown> | null
            return (
                execution?.kind === 'built_in' &&
                execution.contractId === provider &&
                execution.revision === revision
            )
        },
        loadControl: () =>
            import('./thread-control').then(module => ({
                default: module.threadControls[provider],
            })),
        summarize: value =>
            Array.isArray(value)
                ? value
                      .map(
                          (item, index) =>
                              `${index + 2}. ${typeof item?.text === 'string' ? item.text : ''}`
                      )
                      .join('\n\n')
                : '',
    }
}
