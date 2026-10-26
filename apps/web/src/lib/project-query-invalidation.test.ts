import { expect, test } from 'bun:test'

import { QueryClient, QueryObserver } from '@tanstack/react-query'

import { refreshPublicationResources, refreshChannelResources } from './project-query-invalidation'
import { projectQueryKeys } from './project-query-keys'

test('publication writes refresh observed feature data without reading navigation or inactive/foreign features', async () => {
    const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    const reads = { visible: 0, inactive: 0, navigation: 0, foreign: 0 }
    const visible = {
        queryKey: projectQueryKeys.publications('one'),
        queryFn: async () => ++reads.visible,
    }
    const inactive = {
        queryKey: projectQueryKeys.duePublications('one'),
        queryFn: async () => ++reads.inactive,
    }
    const navigation = {
        queryKey: projectQueryKeys.channels('one'),
        queryFn: async () => ++reads.navigation,
    }
    const foreign = {
        queryKey: projectQueryKeys.publications('two'),
        queryFn: async () => ++reads.foreign,
    }
    try {
        await Promise.all([
            client.fetchQuery(visible),
            client.fetchQuery(inactive),
            client.fetchQuery(navigation),
            client.fetchQuery(foreign),
        ])
        const observer = new QueryObserver(client, visible)
        const unsubscribe = observer.subscribe(() => {})
        try {
            await refreshPublicationResources(client, 'one')
            expect(reads).toEqual({ visible: 2, inactive: 1, navigation: 1, foreign: 1 })
            expect(client.getQueryState(inactive.queryKey)?.isInvalidated).toBe(true)
            expect(client.getQueryState(navigation.queryKey)?.isInvalidated).toBe(false)
            expect(client.getQueryState(foreign.queryKey)?.isInvalidated).toBe(false)
            await client.fetchQuery(inactive)
            expect(reads.inactive).toBe(2)
        } finally {
            unsubscribe()
        }
    } finally {
        client.clear()
    }
})

test('channel mutations invalidate their navigation data and publication projections while preserving membership and tag catalog', async () => {
    const client = new QueryClient()
    const keys = {
        channels: projectQueryKeys.channels('one'),
        connections: projectQueryKeys.connections('one'),
        destinations: projectQueryKeys.publicationDestinations('one'),
        publications: projectQueryKeys.publications('one'),
        membership: projectQueryKeys.membership('one'),
        tags: projectQueryKeys.projectTagsCatalog('one'),
    }
    try {
        for (const key of Object.values(keys)) client.setQueryData(key, 'snapshot')
        await refreshChannelResources(client, 'one')
        for (const name of ['channels', 'connections', 'publications', 'destinations'] as const)
            expect(client.getQueryState(keys[name])?.isInvalidated).toBe(true)
        for (const name of ['membership', 'tags'] as const)
            expect(client.getQueryState(keys[name])?.isInvalidated).toBe(false)
    } finally {
        client.clear()
    }
})
