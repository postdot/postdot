import { expect, it } from 'bun:test'

import type { Agent } from '@atproto/api'

import { createBlueskyVideoService, readBlueskyVideoBlob } from './video'

// cspell:ignore bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku
const blob = {
    $type: 'blob',
    ref: { $link: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku' },
    mimeType: 'video/mp4',
    size: 4,
}
function agent() {
    const tokens: unknown[] = []
    return {
        tokens,
        value: {
            did: 'did:plc:video',
            com: {
                atproto: {
                    server: {
                        async getServiceAuth(input: unknown) {
                            tokens.push(input)
                            return { data: { token: 'private-video-token' } }
                        },
                    },
                },
            },
        } as unknown as Pick<Agent, 'did' | 'com'>,
    }
}
it('uses separate scoped tokens, transfers bytes, and resolves processing or an existing blob', async () => {
    const fixture = agent()
    let posted = 0
    let ready = false
    const service = createBlueskyVideoService({
        agent: fixture.value,
        pdsUrl: 'https://pds.example.com',
        now: () => 1_800_000_000_123,
        fetcher: async (url, init) => {
            expect(init?.signal).toBeDefined()
            if (String(url).includes('getUploadLimits')) {
                expect(init?.headers).toMatchObject({ Authorization: 'Bearer private-video-token' })
                return Response.json({
                    canUpload: true,
                    remainingDailyVideos: 1,
                    remainingDailyBytes: 4,
                })
            }
            if (init?.method === 'POST') {
                posted++
                expect(new URL(String(url)).searchParams.get('did')).toBe('did:plc:video')
                expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(
                    new Uint8Array([1, 2, 3, 4])
                )
                return Response.json(
                    ready
                        ? { error: 'already_exists', blob }
                        : { jobId: 'job-video', state: 'PROCESSING' },
                    { status: ready ? 409 : 200 }
                )
            }
            expect(init?.headers).toBeUndefined()
            return Response.json({
                jobStatus: ready
                    ? { jobId: 'job-video', state: 'JOB_STATE_COMPLETED', blob }
                    : { jobId: 'job-video', state: 'PROCESSING' },
            })
        },
    })
    expect(await service.checkLimits(4)).toEqual({ type: 'allowed' })
    expect(
        await service.upload({ size: 4, stream: new Blob([new Uint8Array([1, 2, 3, 4])]).stream() })
    ).toEqual({ type: 'processing', jobId: 'job-video' })
    expect(await service.getJob('job-video')).toEqual({ type: 'processing', jobId: 'job-video' })
    ready = true
    expect(await service.getJob('job-video')).toEqual({
        type: 'ready',
        blob: readBlueskyVideoBlob(blob)!,
    })
    expect(
        await service.upload({ size: 4, stream: new Blob([new Uint8Array([1, 2, 3, 4])]).stream() })
    ).toEqual({ type: 'ready', blob: readBlueskyVideoBlob(blob)! })
    expect(posted).toBe(2)
    expect(fixture.tokens).toEqual([
        {
            aud: 'did:web:video.bsky.app',
            lxm: 'app.bsky.video.getUploadLimits',
            exp: 1_800_001_800,
        },
        { aud: 'did:web:pds.example.com', lxm: 'com.atproto.repo.uploadBlob', exp: 1_800_001_800 },
        { aud: 'did:web:pds.example.com', lxm: 'com.atproto.repo.uploadBlob', exp: 1_800_001_800 },
    ])
})
it('rejects quota and processing failures, distinguishes unknown uploads, and never echoes remote secrets', async () => {
    const fixture = agent()
    let body: unknown = { canUpload: false, message: 'private-video-token' }
    let status = 200
    const service = createBlueskyVideoService({
        agent: fixture.value,
        pdsUrl: 'https://pds.example.com',
        fetcher: async () => Response.json(body, { status }),
    })
    expect(await service.checkLimits(4)).toMatchObject({ type: 'permanent_failure' })
    body = { canUpload: true, remainingDailyBytes: 3 }
    expect(await service.checkLimits(4)).toMatchObject({ type: 'permanent_failure' })
    body = {
        jobStatus: { jobId: 'job', state: 'JOB_STATE_FAILED', message: 'private-video-token' },
    }
    const failed = await service.getJob('job')
    expect(failed.type).toBe('permanent_failure')
    expect(JSON.stringify(failed)).not.toContain('private-video-token')
    status = 503
    expect(await service.getJob('job')).toMatchObject({ type: 'retryable_failure' })
    expect(await service.upload({ size: 4, stream: new Blob(['test']).stream() })).toMatchObject({
        type: 'ambiguous',
    })
    status = 200
    body = { jobStatus: { jobId: 'another-job', state: 'PROCESSING' } }
    expect(await service.getJob('job')).toMatchObject({ type: 'permanent_failure' })
})

it('rejects an invalid processed blob and a ready response for a different processing job', async () => {
    const fixture = agent()
    let body: unknown = { jobStatus: { jobId: 'other', state: 'JOB_STATE_COMPLETED', blob } }
    const service = createBlueskyVideoService({
        agent: fixture.value,
        pdsUrl: 'https://pds.example.com',
        fetcher: async () => Response.json(body),
    })
    expect(await service.getJob('expected')).toMatchObject({ type: 'permanent_failure' })
    body = {
        jobStatus: {
            jobId: 'expected',
            state: 'JOB_STATE_COMPLETED',
            blob: { ...blob, mimeType: 'image/png' },
        },
    }
    expect(await service.getJob('expected')).toMatchObject({ type: 'permanent_failure' })
})
