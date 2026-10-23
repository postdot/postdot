import type { ComponentType, Dispatch, SetStateAction } from 'react'

import type { ProviderApplicationFormState } from '@/components/provider-application-form'
import type { ProviderApplication, ProviderApplicationInput } from '@/lib/api'
export interface ProviderApplicationFieldsProps {
    readonly form: ProviderApplicationFormState
    readonly onFormChange: Dispatch<SetStateAction<ProviderApplicationFormState>>
    readonly editingId: string | null
    readonly preserveSecret: boolean
    readonly callbacks: Readonly<Record<string, string | undefined>>
}
export interface OAuthApplicationFields {
    readonly numeric?: boolean
    readonly clientLabel?: () => string
    readonly secretLabel?: () => string
    readonly callback?: string
    readonly callbackLabel?: () => string
    readonly callbackHelp?: () => string
    readonly httpsHelp?: () => string
}
export interface ProviderApplicationDefinition {
    readonly label: () => string
    readonly defaults?: Partial<ProviderApplicationFormState>
    readonly Fields: ComponentType<ProviderApplicationFieldsProps>
    readonly canSubmit: (form: ProviderApplicationFormState, saved?: ProviderApplication) => boolean
    readonly input: (
        form: ProviderApplicationFormState
    ) => Omit<ProviderApplicationInput, 'providerId' | 'name' | 'isDefault'>
    readonly status: (saved: ProviderApplication) => string
}
