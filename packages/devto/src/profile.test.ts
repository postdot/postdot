import { describe, expect, it } from 'bun:test'

import { ChannelProfileCompiler, adaptSourceContentToProfile } from '@postbot/core'

import { devtoChannelProfile } from './profile'

describe('DEV.to channel profile', () => {
    it('maps a Postbot headline and body to a publishable article target', () => {
        const target = adaptSourceContentToProfile(
            {
                headline: 'A Postbot article',
                body: { text: '# Hello DEV.to', format: 'markdown' },
                media: [],
            },
            devtoChannelProfile
        )

        expect(target).toEqual({
            title: 'A Postbot article',
            body_markdown: '# Hello DEV.to',
            media: [],
        })
        expect(new ChannelProfileCompiler().compile(devtoChannelProfile).ok).toBe(true)
    })

    it('requires a title because DEV.to articles cannot be published without one', () => {
        const compiled = new ChannelProfileCompiler().compile(devtoChannelProfile)
        if (!compiled.ok) throw new Error('The DEV.to profile must compile')

        expect(compiled.value.validate({ body_markdown: 'Body', media: [] })).toMatchObject({
            ok: false,
        })
    })
})
