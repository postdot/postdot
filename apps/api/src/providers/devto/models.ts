import { Type } from 'typebox'

import { publisherConnectionSchema } from '../../modules/projects/models'
export const devtoConnectionBody = Type.Object({
    apiKey: Type.String({ minLength: 1, maxLength: 4_096, writeOnly: true }),
})

export const devtoConnectionResponse = Type.Object({
    connection: publisherConnectionSchema,
})
