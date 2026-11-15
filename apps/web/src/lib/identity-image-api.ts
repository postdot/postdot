import { client, unwrap } from './api-transport'

export type IdentityTarget =
    | { readonly kind: 'project'; readonly id: string }
    | { readonly kind: 'workspace'; readonly id: string }
    | { readonly kind: 'channel'; readonly id: string; readonly projectId: string }

export type IdentityImageChange =
    | { readonly kind: 'upload'; readonly file: File }
    | { readonly kind: 'url'; readonly url: string }
    | { readonly kind: 'favicon' | 'remove' }

export async function setIdentityWebsite(
    target: IdentityTarget,
    websiteUrl: string | null,
    expectedRevision?: number
) {
    if (target.kind === 'project')
        return unwrap(
            await client.api.projects({ projectId: target.id }).website.put({ websiteUrl })
        ).project
    if (target.kind === 'workspace')
        return unwrap(
            await client.api.workspaces({ workspaceId: target.id }).website.put({ websiteUrl })
        ).workspace
    return unwrap(
        await client.api
            .projects({ projectId: target.projectId })
            .channels({ channelId: target.id })
            .website.put({ websiteUrl, expectedRevision })
    ).channel
}

export async function changeIdentityImage(
    target: IdentityTarget,
    change: IdentityImageChange,
    expectedRevision?: number
) {
    if (target.kind === 'project') {
        const route = client.api.projects({ projectId: target.id }).image
        if (change.kind === 'upload')
            return unwrap(
                await route.post(undefined, {
                    headers: { 'content-type': 'application/octet-stream' },
                    fetch: { body: change.file },
                })
            ).project
        if (change.kind === 'url') return unwrap(await route.url.post({ url: change.url })).project
        if (change.kind === 'favicon') return unwrap(await route.favicon.post()).project
        return unwrap(await route.delete()).project
    }
    if (target.kind === 'workspace') {
        const route = client.api.workspaces({ workspaceId: target.id }).image
        if (change.kind === 'upload')
            return unwrap(
                await route.post(undefined, {
                    headers: { 'content-type': 'application/octet-stream' },
                    fetch: { body: change.file },
                })
            ).workspace
        if (change.kind === 'url')
            return unwrap(await route.url.post({ url: change.url })).workspace
        if (change.kind === 'favicon') return unwrap(await route.favicon.post()).workspace
        return unwrap(await route.delete()).workspace
    }
    const route = client.api
        .projects({ projectId: target.projectId })
        .channels({ channelId: target.id }).image
    if (change.kind === 'upload')
        return unwrap(
            await route.post(undefined, {
                query: { expectedRevision },
                headers: { 'content-type': 'application/octet-stream' },
                fetch: { body: change.file },
            })
        ).channel
    if (change.kind === 'url')
        return unwrap(await route.url.post({ url: change.url, expectedRevision })).channel
    if (change.kind === 'favicon')
        return unwrap(await route.favicon.post(undefined, { query: { expectedRevision } })).channel
    return unwrap(await route.delete(undefined, { query: { expectedRevision } })).channel
}
