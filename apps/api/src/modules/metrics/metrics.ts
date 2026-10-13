import type { NextEventScheduler } from '@postbot/core'
import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client'

import type { PublicationWorkerRunObservation } from '../workflow/worker'

const schedulerStates = ['idle', 'started', 'running', 'stopped', 'failed'] as const

export interface PostbotMetrics {
    readonly registry: Registry
    bindScheduler(scheduler: Pick<NextEventScheduler, 'state'>): void
    observeWorkerRun(observation: PublicationWorkerRunObservation): void
}

export function createPostbotMetrics(): PostbotMetrics {
    const registry = new Registry()
    let previousCpuUsage = { user: 0, system: 0 }

    new Counter<'mode'>({
        name: 'postbot_process_cpu_seconds_total',
        help: 'The cumulative CPU time used by this Postbot process in seconds.',
        labelNames: ['mode'],
        registers: [registry],
        collect() {
            const current = process.cpuUsage()
            const userDelta = current.user - previousCpuUsage.user
            const systemDelta = current.system - previousCpuUsage.system
            if (userDelta > 0) this.inc({ mode: 'user' }, userDelta / 1_000_000)
            if (systemDelta > 0) this.inc({ mode: 'system' }, systemDelta / 1_000_000)
            previousCpuUsage = current
        },
    })
    new Gauge<'type'>({
        name: 'postbot_process_memory_bytes',
        help: 'The current memory usage of this Postbot process in bytes.',
        labelNames: ['type'],
        registers: [registry],
        collect() {
            const memory = process.memoryUsage()
            this.set({ type: 'rss' }, memory.rss)
            this.set({ type: 'heap_total' }, memory.heapTotal)
            this.set({ type: 'heap_used' }, memory.heapUsed)
            this.set({ type: 'external' }, memory.external)
            this.set({ type: 'array_buffers' }, memory.arrayBuffers)
        },
    })
    new Gauge({
        name: 'postbot_process_uptime_seconds',
        help: 'The time this Postbot process has been running in seconds.',
        registers: [registry],
        collect() {
            this.set(process.uptime())
        },
    })

    let scheduler: Pick<NextEventScheduler, 'state'> | undefined
    new Gauge<'state'>({
        name: 'postbot_publication_scheduler_state',
        help: 'The current publication scheduler state, represented by a one-hot state label.',
        labelNames: ['state'],
        registers: [registry],
        collect() {
            for (const state of schedulerStates) {
                this.set({ state }, scheduler?.state === state ? 1 : 0)
            }
        },
    })
    const workerRuns = new Counter<'outcome'>({
        name: 'postbot_publication_worker_runs_total',
        help: 'The number of completed publication worker runs by outcome.',
        labelNames: ['outcome'],
        registers: [registry],
    })
    const workerRunDuration = new Histogram<'outcome'>({
        name: 'postbot_publication_worker_run_duration_seconds',
        help: 'The duration of completed publication worker runs in seconds.',
        labelNames: ['outcome'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60],
        registers: [registry],
    })

    return {
        registry,
        bindScheduler(value) {
            scheduler = value
        },
        observeWorkerRun({ outcome, durationSeconds }) {
            workerRuns.inc({ outcome })
            workerRunDuration.observe({ outcome }, durationSeconds)
        },
    }
}
