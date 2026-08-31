import { describe, expect, test } from 'bun:test'

import { cn } from './utils'

describe('cn', () => {
    test('merges conditional and conflicting Tailwind classes', () => {
        expect(cn('px-2', { hidden: false }, 'px-4')).toBe('px-4')
    })
})
