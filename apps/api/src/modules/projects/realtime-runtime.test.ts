import { describe, expect, it } from 'bun:test'

import { createProjectRealtimeRuntime } from './realtime-runtime'

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe('project realtime runtime', () => {
    it('keeps the durable projection independent of SSE subscribers', () => {
        const projected: string[][] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: projectIds => projected.push([...projectIds]),
        })

        runtime.publish(['project-cli-only'])

        expect(projected).toEqual([['project-cli-only']])
        runtime.stop()
    })

    it('wakes only the projects named by a post-commit signal', async () => {
        const changed: string[][] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: projectIds => changed.push([...projectIds]),
        })
        const firstController = new AbortController()
        const secondController = new AbortController()
        const unrelatedController = new AbortController()
        let unrelatedResolved = false

        const first = runtime.hub.waitForChange('project-1', firstController.signal)
        const second = runtime.hub.waitForChange('project-3', secondController.signal)
        const unrelated = runtime.hub
            .waitForChange('project-2', unrelatedController.signal)
            .then(() => {
                unrelatedResolved = true
            })

        runtime.publish(['project-3', 'project-1', 'project-3'])
        await Promise.all([first, second])

        expect(changed).toEqual([['project-3', 'project-1']])
        expect(unrelatedResolved).toBe(false)
        unrelatedController.abort()
        await unrelated
        runtime.stop()
    })

    it('wakes only users who belong to changed projects', async () => {
        const runtime = createProjectRealtimeRuntime({
            resolveUserIdsForProjects: projectIds =>
                projectIds.includes('project-1') ? ['user-1'] : ['user-2'],
        })
        const firstController = new AbortController()
        const secondController = new AbortController()
        let firstResolved = false
        let secondResolved = false
        const first = runtime.userHub.waitForChange('user-1', firstController.signal).then(() => {
            firstResolved = true
        })
        const second = runtime.userHub.waitForChange('user-2', secondController.signal).then(() => {
            secondResolved = true
        })

        runtime.publish(['project-1'])
        await first

        expect(firstResolved).toBe(true)
        expect(secondResolved).toBe(false)
        secondController.abort()
        await second
        runtime.stop()
    })

    it('still wakes streams when the projection callback fails', async () => {
        const errors: unknown[] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: () => {
                throw new Error('projection failed')
            },
            onError: error => errors.push(error),
        })
        const controller = new AbortController()
        const pending = runtime.hub.waitForChange('project-1', controller.signal)

        runtime.publish(['project-1'])
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not wake its waiter')
            }),
        ])

        expect(errors).toHaveLength(1)
        runtime.stop()
    })

    it('resolves waiters when the runtime stops', async () => {
        const runtime = createProjectRealtimeRuntime()
        const pending = runtime.hub.waitForChange('project-1', new AbortController().signal)

        runtime.stop()
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not resolve on shutdown')
            }),
        ])
    })

    it('does not wake a waiter after shutdown', async () => {
        const runtime = createProjectRealtimeRuntime()
        runtime.stop()
        await runtime.hub.waitForChange('project-1', new AbortController().signal)
        runtime.publish(['project-1'])
    })
})
