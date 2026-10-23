import type { ChannelListItem } from '@/lib/api'
import { providerRegistry } from '@/providers/registry'
export function getNativePlatform(execution: ChannelListItem['execution'] | undefined) {
    return providerRegistry.forExecution(execution)?.id ?? 'custom'
}
export function getNativeEditorProfile(execution: ChannelListItem['execution'] | undefined) {
    return providerRegistry.forExecution(execution)?.editor ?? 'plain'
}
