import { Type } from 'typebox'

import { publisherConnectionSchema } from '../../modules/projects/models'
export const discordConnectionBody = Type.Object({
    botToken: Type.String({ minLength: 32, maxLength: 4_096, writeOnly: true }),
    channelId: Type.String({ minLength: 17, maxLength: 20 }),
})

export const discordConnectionResponse = Type.Object({
    connection: publisherConnectionSchema,
})
