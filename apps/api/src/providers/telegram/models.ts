import { Type } from 'typebox'

import { publisherConnectionSchema } from '../../modules/projects/models'
export const telegramConnectionBody = Type.Object({
    botToken: Type.String({ minLength: 1, maxLength: 512, writeOnly: true }),
    chatReference: Type.String({ minLength: 1, maxLength: 128 }),
})

export const telegramConnectionResponse = Type.Object({ connection: publisherConnectionSchema })
