import { expect, test } from 'bun:test'

import { workflowRecoveryDelay } from './recovery'

test('only PostgreSQL transaction conflicts receive capped scheduler recovery', () => {
    for (const errno of ['40001', '40P01']) {
        const error = Object.assign(new Error('conflict'), { errno })
        expect(
            [1, 2, 3, 4, 5, 6, 100].map(n => workflowRecoveryDelay('postgres', error, n))
        ).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
        expect(workflowRecoveryDelay('sqlite', error, 1)).toBeNull()
    }
    for (const error of [null, new Error('40001'), { errno: '23505' }, { errno: '08006' }])
        expect(workflowRecoveryDelay('postgres', error, 1)).toBeNull()
})
