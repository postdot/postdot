import type { createManualStore, createPublisherStore } from '@herald/db'

import type { AuthenticatedElysia } from '../../plugins/auth'

export type ManualStore = ReturnType<typeof createManualStore>
export type PublisherStore = ReturnType<typeof createPublisherStore>
export type { AuthenticatedElysia }
