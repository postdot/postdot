import type { ComponentType } from 'react'

import type { api } from '@/lib/api'
import type {
    ChannelListItem,
    ProviderApplication,
    ProviderApplicationProvider,
    PublisherConnection,
} from '@/lib/api'
import type { Locale } from '@/paraglide/runtime.js'

import type { ProviderApplicationDefinition } from './application-contract'

export interface ProviderConnectionProps {
    readonly channel: ChannelListItem
    readonly disabled: boolean
    readonly reconnect: boolean
    readonly applications: readonly ProviderApplication[]
    readonly applicationId?: string
    readonly onApplicationChange: (id: string) => void
    readonly onConnected: () => Promise<boolean>
}

export interface ProviderDefinition {
    readonly id: string
    readonly name: string
    readonly suggestedName?: string
    readonly profileLabel: () => string
    readonly editor: 'plain' | 'article' | 'discord'
    readonly application?: ProviderApplicationDefinition
    readonly applicationProvider?: ProviderApplicationProvider
    readonly loadConnection: () => Promise<{ default: ComponentType<ProviderConnectionProps> }>
    readonly accountLabel: (connection: PublisherConnection) => string
    readonly accountDetails?: (connection: PublisherConnection) => string
    readonly connectionHint?: () => string
    readonly Glyph?: ComponentType<{ readonly action: 'reply' | 'repost' | 'like' | 'share' }>
    readonly glyphs?: Partial<
        Record<
            'reply' | 'repost' | 'like' | 'share',
            { readonly viewBox: string; readonly path: string }
        >
    >
    readonly preview: {
        readonly layout: 'professional' | 'article' | 'message' | 'social'
        readonly accountDriven: boolean
        readonly sampleIdentity: boolean
        readonly mosaic?: 'tight' | 'spaced'
        readonly handle?: string
        readonly Footer?: ComponentType
        readonly SampleEngagement?: ComponentType
        readonly Poll?: ComponentType<{ readonly poll: unknown }>
        readonly footerClassName?: string
    }
    readonly fields?: readonly ProviderFieldDefinition[]
    readonly textLimit?: (profile: unknown, target?: unknown) => number | null
    readonly templateUpgrade?: { readonly revision: string; readonly presetId: string }
    readonly markerClassName?: string
    readonly authoring?: { readonly preserveEmptyHeadline: boolean }
    readonly text?: {
        readonly algorithm: string
        readonly parse: (value: string) => ProviderTextValidation
        readonly Count: ComponentType<{
            readonly id: string
            readonly invalid: boolean
            readonly result: ProviderTextValidation
        }>
    }
    readonly analytics?: {
        readonly metrics: readonly { readonly key: string; readonly label: () => string }[]
        readonly legacyProfileIdentity?: boolean
        readonly listLatest: (
            reader: Partial<typeof api>,
            projectId: string,
            ids: readonly string[]
        ) => Promise<ProviderAnalyticsPage>
        readonly collect: (
            reader: Partial<typeof api>,
            projectId: string,
            channelId: string,
            publicationId: string
        ) => Promise<unknown>
    }
    readonly legacyText?: {
        readonly bindingId: string
        readonly maxWeightedLength: number
        readonly weightedLengthAlgorithm: string
    }
    readonly comments?: {
        readonly textLimit: number
        readonly countUnit: 'graphemes' | 'utf16'
        readonly inspectable: (externalId: string, externalUrl: string | null) => boolean
        readonly maxLength: number
        readonly count: (text: string) => number
        readonly linkAllowed: (url: string, origin: string | null) => boolean
    }
}

export interface ProviderFieldProps {
    readonly value: unknown
    readonly disabled: boolean
    readonly fieldId: string
    readonly question: string
    readonly onChange: (value: unknown | undefined) => void
    readonly error?: string
}
export interface ProviderFieldDefinition {
    readonly kind: `provider:${string}`
    readonly path: string
    readonly label: (locale?: Locale) => string
    readonly supports: (profile: unknown) => boolean
    readonly loadControl: () => Promise<{ default: ComponentType<ProviderFieldProps> }>
    readonly summarize: (value: unknown) => string
}

export interface ProviderTextValidation {
    readonly valid: boolean
    readonly weightedLength: number | null
    readonly hasInvalidCharacters: boolean
}
export type ProviderAnalyticsPage = Awaited<
    ReturnType<typeof api.listLatestBlueskyProviderAnalytics>
>
