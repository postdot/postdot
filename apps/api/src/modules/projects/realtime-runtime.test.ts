import { describe, expect, it } from 'bun:test'

import { createProjectRealtimeRuntime } from './realtime-runtime'

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe('project realtime runtime', () => {
    it('drains an in-flight user lookup after closing stream waiters', async () => {
        const entered = Promise.withResolvers<void>()
        const read = Promise.withResolvers<readonly string[]>()
        const runtime = createProjectRealtimeRuntime({
            resolveUserIdsForProjects() {
                entered.resolve()
                return read.promise
            },
        })
        const waiter = runtime.userHub.waitForChange('user', new AbortController().signal)
        const publishing = runtime.publish(['project'])
        await entered.promise
        let stopped = false
        const stopping = runtime.stop().then(() => {
            stopped = true
        })
        await waiter
        expect(stopped).toBe(false)
        read.resolve(['user'])
        await Promise.all([publishing, stopping])
        expect(stopped).toBe(true)
    })

    it('keeps the durable projection independent of SSE subscribers', async () => {
        const projected: string[][] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: projectIds => {
                projected.push([...projectIds])
            },
        })

        await runtime.publish(['project-cli-only'])

        expect(projected).toEqual([['project-cli-only']])
        await runtime.stop()
    })

    it('wakes only the projects named by a post-commit signal', async () => {
        const changed: string[][] = []
        const runtime = createProjectRealtimeRuntime({
            onProjectsChanged: projectIds => {
                changed.push([...projectIds])
            },
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

        await runtime.publish(['project-3', 'project-1', 'project-3'])
        await Promise.all([first, second])

        expect(changed).toEqual([['project-3', 'project-1']])
        expect(unrelatedResolved).toBe(false)
        unrelatedController.abort()
        await unrelated
        await runtime.stop()
    })

    it('wakes only users who belong to changed projects', async () => {
        const runtime = createProjectRealtimeRuntime({
            resolveUserIdsForProjects: async projectIds =>
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

        await runtime.publish(['project-1'])
        await first

        expect(firstResolved).toBe(true)
        expect(secondResolved).toBe(false)
        secondController.abort()
        await second
        await runtime.stop()
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

        await runtime.publish(['project-1'])
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not wake its waiter')
            }),
        ])

        expect(errors).toHaveLength(1)
        await runtime.stop()
    })

    it('resolves waiters when the runtime stops', async () => {
        const runtime = createProjectRealtimeRuntime()
        const pending = runtime.hub.waitForChange('project-1', new AbortController().signal)

        await runtime.stop()
        await Promise.race([
            pending,
            wait(250).then(() => {
                throw new Error('The realtime runtime did not resolve on shutdown')
            }),
        ])
    })

    it('does not wake a waiter after shutdown', async () => {
        const runtime = createProjectRealtimeRuntime()
        await runtime.stop()
        await runtime.hub.waitForChange('project-1', new AbortController().signal)
        await runtime.publish(['project-1'])
    })

    it('tells both served hubs that the runtime stopped', async () => {
        const runtime = createProjectRealtimeRuntime()
        let projectNotifications = 0
        let userNotifications = 0
        runtime.hub.subscribeShutdown?.(() => {
            projectNotifications += 1
        })
        runtime.userHub.subscribeShutdown?.(() => {
            userNotifications += 1
        })

        await runtime.stop()

        expect(projectNotifications).toBe(1)
        expect(userNotifications).toBe(1)
    })

    it('tells a listener that subscribes after the runtime stopped', async () => {
        const runtime = createProjectRealtimeRuntime()
        await runtime.stop()
        let notified = false

        runtime.hub.subscribeShutdown?.(() => {
            notified = true
        })

        expect(notified).toBe(true)
    })

    it('stops notifying a listener that unsubscribed', async () => {
        const runtime = createProjectRealtimeRuntime()
        let notified = false
        const unsubscribe = runtime.hub.subscribeShutdown?.(() => {
            notified = true
        })

        unsubscribe?.()
        await runtime.stop()

        expect(notified).toBe(false)
    })

    it('keeps notifying the remaining listeners when one fails', async () => {
        const errors: unknown[] = []
        const runtime = createProjectRealtimeRuntime({ onError: error => errors.push(error) })
        let notified = false
        runtime.hub.subscribeShutdown?.(() => {
            throw new Error('shutdown listener failed')
        })
        runtime.userHub.subscribeShutdown?.(() => {
            notified = true
        })

        await runtime.stop()

        expect(notified).toBe(true)
        expect(errors).toHaveLength(1)
    })
})
