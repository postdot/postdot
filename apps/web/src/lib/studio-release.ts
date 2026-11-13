import type { ReleaseIdentity } from './release-identity'

// This literal belongs to the loaded JavaScript, not a mutable HTTP metadata file.
export const studioRelease: ReleaseIdentity =
    typeof __POSTDOT_STUDIO_RELEASE__ === 'undefined'
        ? { version: null, revision: null }
        : __POSTDOT_STUDIO_RELEASE__
