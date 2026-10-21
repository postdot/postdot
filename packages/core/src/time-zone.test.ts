import { describe, expect, it } from 'bun:test'

import {
    createProject,
    defaultProjectTimeZone,
    isValidProjectTimeZone,
    requireProjectTimeZone,
} from './index'

describe('project time zones', () => {
    it('uses UTC when a project does not provide a timezone', () => {
        const project = createProject({ id: 'project-1', name: 'Postdot', now: 1_800_000_000_000 })

        expect(project.timeZone).toBe(defaultProjectTimeZone)
    })

    it('accepts canonical IANA identifiers and rejects fixed offsets', () => {
        expect(isValidProjectTimeZone('Europe/Paris')).toBe(true)
        expect(isValidProjectTimeZone('America/New_York')).toBe(true)
        expect(isValidProjectTimeZone('UTC')).toBe(true)
        expect(isValidProjectTimeZone('+02:00')).toBe(false)
        expect(isValidProjectTimeZone('GMT')).toBe(false)
        expect(isValidProjectTimeZone('')).toBe(false)
    })

    it('normalizes whitespace before validating an optional timezone', () => {
        expect(requireProjectTimeZone('  Europe/Paris  ')).toBe('Europe/Paris')
        expect(() => requireProjectTimeZone('not-a-timezone')).toThrow(
            'timeZone must be a valid IANA time zone identifier'
        )
    })
})
