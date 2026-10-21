import type { createManualStore } from '@postdot/db'

import type { AuthenticatedElysia } from '../../plugins/auth'
import type { PublisherRuntime } from '../publishers/runtime'

export type ManualStore = ReturnType<typeof createManualStore>
export type { PublisherRuntime }
export type { AuthenticatedElysia }
