import type { ChannelExecutionContract, ExternalEffectOutcome } from '@postdot/core'
import type {
    CompleteProviderMediaDeliveryInput,
    FailProviderMediaDeliveryInput,
    MediaAssetStore,
    PublisherCredentialSecrets,
    PublisherExecutionTarget,
    ProviderMediaDelivery,
    RecordProviderMediaDeliveryRemoteIdInput,
    ReplacePublisherCredentialTokensInput,
    ReplacePublisherCredentialTokensResult,
    ReserveProviderMediaDeliveryInput,
    RetryProviderMediaDeliveryInput,
    StartProviderMediaDeliveryInput,
} from '@postdot/db'

export type BuiltInExecutionContract = Extract<
    ChannelExecutionContract,
    { readonly kind: 'built_in' }
>

export type ProviderMediaContentStore = Pick<MediaAssetStore, 'openRepresentationContent'>

export interface PublisherCredentialExecutionPort {
    /** Providers that require stored grant verification fail closed when unavailable. */
    getPublisherCredential?(
        projectId: string,
        credentialId: string
    ): { readonly scopes: readonly string[] } | null
    resolvePublisherCredentialSecrets(
        projectId: string,
        credentialId: string
    ): Promise<PublisherCredentialSecrets | null>
    replacePublisherCredentialTokens(
        input: ReplacePublisherCredentialTokensInput
    ): Promise<ReplacePublisherCredentialTokensResult>
    markPublisherCredentialReconnectRequired(projectId: string, credentialId: string): void
}

export interface ProviderMediaDeliveryPort {
    reserve(input: ReserveProviderMediaDeliveryInput): ProviderMediaDelivery
    start(input: StartProviderMediaDeliveryInput): ProviderMediaDelivery | null
    recordRemoteMediaId(
        input: RecordProviderMediaDeliveryRemoteIdInput
    ): ProviderMediaDelivery | null
    complete(input: CompleteProviderMediaDeliveryInput): ProviderMediaDelivery | null
    fail(input: FailProviderMediaDeliveryInput): ProviderMediaDelivery | null
    retry(input: RetryProviderMediaDeliveryInput): ProviderMediaDelivery | null
}

export interface BuiltInProviderExecutionInput {
    readonly target: PublisherExecutionTarget
    readonly now: number
    readonly credentials: PublisherCredentialExecutionPort
    readonly media?: ProviderMediaContentStore
    readonly resolveMediaUrl?: (
        media: PublisherExecutionTarget['media'][number],
        context: { readonly projectId: string }
    ) => string | null | Promise<string | null>
    readonly providerMediaDeliveryStore: ProviderMediaDeliveryPort
}

export interface BuiltInProviderAdapter {
    readonly providerId: string
    readonly contractId: string
    readonly revision: string
    execute(input: BuiltInProviderExecutionInput): Promise<ExternalEffectOutcome>
}

export interface BuiltInProviderRegistry {
    resolve(input: {
        readonly providerId: string
        readonly kind: string
        readonly execution: ChannelExecutionContract
    }): BuiltInProviderAdapter | null
}

function identityKey(contractId: string, revision: string): string {
    return `${contractId}\u0000${revision}`
}

export function createBuiltInProviderRegistry(
    adapters: readonly BuiltInProviderAdapter[]
): BuiltInProviderRegistry {
    const adaptersByIdentity = new Map<string, BuiltInProviderAdapter>()

    for (const adapter of adapters) {
        if (adapter.providerId.trim().length === 0) {
            throw new Error('Built-in provider adapters require a provider ID')
        }
        if (adapter.contractId.trim().length === 0 || adapter.revision.trim().length === 0) {
            throw new Error('Built-in provider adapters require a contract identity and revision')
        }
        const key = identityKey(adapter.contractId, adapter.revision)
        if (adaptersByIdentity.has(key)) {
            throw new Error(
                `Duplicate built-in provider execution contract: ${adapter.contractId}@${adapter.revision}`
            )
        }
        adaptersByIdentity.set(key, adapter)
    }

    return {
        resolve(input) {
            if (input.execution.kind !== 'built_in') return null

            const adapter = adaptersByIdentity.get(
                identityKey(input.execution.contractId, input.execution.revision)
            )
            if (adapter === undefined) return null
            if (adapter.providerId !== input.providerId || adapter.providerId !== input.kind) {
                return null
            }
            return adapter
        },
    }
}
