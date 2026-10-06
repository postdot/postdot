import { describe, expect, test } from 'bun:test'

import {
    activeChannelProfilePromotionErrorPrefix,
    isActiveChannelProfilePromotionError,
} from './publication-promotion'

describe('publication promotion helpers', () => {
    test('recognizes an active-profile promotion refusal', () => {
        const error = {
            status: 400,
            code: 'invalid_content',
            message: `${activeChannelProfilePromotionErrorPrefix} future-provider v2 while it satisfies future-provider v1: Field body is too long`,
        }

        expect(isActiveChannelProfilePromotionError(error)).toBe(true)
    })

    test('ignores other invalid-content promotion failures', () => {
        const error = {
            status: 400,
            code: 'invalid_content',
            message: 'Publication target content is invalid: Field body is too long',
        }

        expect(isActiveChannelProfilePromotionError(error)).toBe(false)
        expect(isActiveChannelProfilePromotionError(new Error('request failed'))).toBe(false)
    })
})
