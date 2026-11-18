import { DomainInvariantError } from '@postdot/core'

export class PostCompositionConflictError extends DomainInvariantError {
    constructor(readonly conflictingPublicationIds: readonly string[]) {
        super(
            'write_conflict',
            'The post or publication drafts changed before the composition could be saved'
        )
    }
}
