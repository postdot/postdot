import type { ExternalEffectOutcome } from '@postdot/core'
import type { PublisherExecutionTarget } from '@postdot/db'
import {
    DEVTO_EXECUTION_CONTRACT_REVISION,
    DEVTO_MAX_IMAGES,
    DEVTO_PROVIDER,
    createDevtoPublisher,
    readDevtoBodyContent,
    readDevtoTitleContent,
    type DevtoFetcher,
    type DevtoPublisher,
} from '@postdot/devto'

import { ambiguousFailure, permanentFailure, retryableFailure } from '../outcomes'
import type { BuiltInProviderAdapter, BuiltInProviderExecutionInput } from './registry'

export interface DevtoProviderAdapterOptions {
    readonly createPublisher?: () => DevtoPublisher
    readonly fetcher?: DevtoFetcher
}

export function createDevtoProviderAdapter(
    options: DevtoProviderAdapterOptions = {}
): BuiltInProviderAdapter {
    return {
        providerId: DEVTO_PROVIDER,
        contractId: DEVTO_PROVIDER,
        revision: DEVTO_EXECUTION_CONTRACT_REVISION,
        execute: input =>
            executeDevtoPublication({
                input,
                createPublisher:
                    options.createPublisher ??
                    (() => createDevtoPublisher({ fetcher: options.fetcher })),
            }),
    }
}

async function executeDevtoPublication(input: {
    readonly input: BuiltInProviderExecutionInput
    readonly createPublisher: () => DevtoPublisher
}): Promise<ExternalEffectOutcome> {
    const { input: execution, createPublisher } = input
    const target = execution.target
    const destination = toDevtoDestination(target.destination)
    if (destination === null || destination.id !== target.externalAccountId) {
        return permanentFailure('The DEV.to publication destination is unavailable')
    }

    const secrets = await execution.credentials.resolvePublisherCredentialSecrets(
        target.projectId,
        target.credentialId
    )
    if (secrets === null) {
        return permanentFailure('The DEV.to publisher credential is unavailable')
    }
    if (secrets.accessToken.trim().length === 0) {
        return permanentFailure('The DEV.to publisher API key is unavailable')
    }

    const title = readDevtoTitleContent(target.content)
    if (title === null) {
        return permanentFailure('The execution revision does not contain a DEV.to article title')
    }
    const bodyMarkdown = readDevtoBodyContent(target.content)
    if (bodyMarkdown === null) {
        return permanentFailure(
            'The execution revision does not contain a DEV.to Markdown article body'
        )
    }

    const mainImageUrl = await resolveMainImageUrl(execution)
    if (mainImageUrl.kind === 'failed') return mainImageUrl.outcome

    let outcome: Awaited<ReturnType<DevtoPublisher['publishArticle']>>
    try {
        outcome = await createPublisher().publishArticle({
            apiKey: secrets.accessToken,
            title,
            bodyMarkdown,
            ...(mainImageUrl.url === undefined ? {} : { mainImageUrl: mainImageUrl.url }),
        })
    } catch {
        return ambiguousFailure('The DEV.to article publication outcome is unknown')
    }

    if (outcome.type === 'permanent_failure' && outcome.code === 'authentication_required') {
        execution.credentials.markPublisherCredentialReconnectRequired(
            target.projectId,
            target.credentialId
        )
    }
    return outcome
}

async function resolveMainImageUrl(
    input: BuiltInProviderExecutionInput
): Promise<
    | { readonly kind: 'ready'; readonly url?: string }
    | { readonly kind: 'failed'; readonly outcome: ExternalEffectOutcome }
> {
    if (input.target.media.length === 0) return { kind: 'ready' }
    if (input.target.media.length > DEVTO_MAX_IMAGES) {
        return {
            kind: 'failed',
            outcome: permanentFailure(`DEV.to articles support at most ${DEVTO_MAX_IMAGES} image`),
        }
    }
    const media = input.target.media[0]
    if (media === undefined) return { kind: 'ready' }
    if (
        media.family !== 'image' ||
        (media.contentType !== 'image/jpeg' && media.contentType !== 'image/png')
    ) {
        return {
            kind: 'failed',
            outcome: permanentFailure('DEV.to articles support JPEG and PNG main images only'),
        }
    }
    if (input.resolveMediaUrl === undefined) {
        return {
            kind: 'failed',
            outcome: permanentFailure(
                'DEV.to image publishing requires signed public media delivery'
            ),
        }
    }

    let url: string | null
    try {
        url = await input.resolveMediaUrl(media, { projectId: input.target.projectId })
    } catch {
        return {
            kind: 'failed',
            outcome: retryableFailure('The DEV.to media URL could not be prepared; retry is safe'),
        }
    }
    if (url === null || !isHttpUrl(url)) {
        return {
            kind: 'failed',
            outcome: permanentFailure('The DEV.to main image URL is unavailable'),
        }
    }
    return { kind: 'ready', url }
}

function toDevtoDestination(
    value: PublisherExecutionTarget['destination']
): { readonly type: 'account'; readonly id: string } | null {
    if (value === null || value.type !== 'account') return null
    const id = value.id.trim()
    return id.length > 0 && !/\s/.test(id) ? { type: 'account', id } : null
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return (
            (url.protocol === 'https:' || url.protocol === 'http:') &&
            url.username.length === 0 &&
            url.password.length === 0
        )
    } catch {
        return false
    }
}
