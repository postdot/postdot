import { expect, it } from 'bun:test'

import { defaultMediaInspectionLimits } from '@postdot/core'

import { createMp4Inspection } from './mp4-inspection'

it('inspects a real H.264 MP4 with its movie index after the video payload', async () => {
    const bytes = await Bun.file(new URL('./fixtures/video-h264.mp4', import.meta.url)).bytes()
    const inspection = createMp4Inspection(bytes.length, defaultMediaInspectionLimits)
    for (let offset = 0; offset < bytes.length; offset += 37)
        inspection.push(bytes.subarray(offset, offset + 37))
    expect(inspection.finish()).toMatchObject({
        family: 'video',
        contentType: 'video/mp4',
        width: 320,
        height: 180,
        durationMs: 4000,
    })
})

it('rejects truncated media and oversized metadata instead of trusting its MIME hint', async () => {
    const bytes = await Bun.file(new URL('./fixtures/video-h264.mp4', import.meta.url)).bytes()
    const truncated = createMp4Inspection(bytes.length, defaultMediaInspectionLimits)
    truncated.push(bytes.subarray(0, bytes.length - 4))
    expect(truncated.finish()).toBeNull()
    const bounded = createMp4Inspection(bytes.length, {
        ...defaultMediaInspectionLimits,
        maxHeaderBytes: 64,
    })
    bounded.push(bytes)
    expect(bounded.finish()).toBeNull()
})
