import { expect, test } from 'bun:test'

test('web transport keeps conflicting publication IDs on composition failures', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
        value: { location: { origin: 'https://postdot.example' } },
        configurable: true,
    })
    try {
        const { errorFrom, unwrap } = await import('./api-transport')
        const error = {
            code: 'write_conflict',
            message: 'Changed elsewhere',
            conflictingPublicationIds: ['one', 'two'],
        }
        expect(() => unwrap({ data: null, error: { value: { error } }, status: 409 })).toThrow(
            expect.objectContaining({
                status: 409,
                code: 'write_conflict',
                conflictingPublicationIds: ['one', 'two'],
            })
        )
        expect(
            errorFrom(409, { error: { ...error, conflictingPublicationIds: ['one', 2, null] } })
                .conflictingPublicationIds
        ).toEqual(['one'])
        expect(errorFrom(400, {}).conflictingPublicationIds).toEqual([])
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
        else Reflect.deleteProperty(globalThis, 'window')
    }
})
