import { describe, expect, it } from 'bun:test'

import { createHeraldMetrics } from './metrics'

describe('Herald Prometheus metrics', () => {
    it('collects process data and fixed-cardinality publication worker metrics', async () => {
        const metrics = createHeraldMetrics()
        metrics.bindScheduler({ state: 'running' })
        metrics.observeWorkerRun({ outcome: 'success', durationSeconds: 0.25 })
        metrics.observeWorkerRun({ outcome: 'failure', durationSeconds: 1.5 })

        const exposition = await metrics.registry.metrics()

        expect(exposition).toContain('herald_process_memory_bytes{type="rss"}')
        expect(exposition).toContain('herald_process_cpu_seconds_total{mode="user"}')
        expect(exposition).toContain('herald_process_uptime_seconds')
        expect(exposition).toContain('herald_publication_scheduler_state{state="running"} 1')
        expect(exposition).toContain('herald_publication_worker_runs_total{outcome="success"} 1')
        expect(exposition).toContain('herald_publication_worker_runs_total{outcome="failure"} 1')
        expect(exposition).toContain(
            'herald_publication_worker_run_duration_seconds_bucket{le="0.5",outcome="success"} 1'
        )
        expect(exposition).not.toMatch(/(?:project|user)_id=/)
    })
})
