import { Button } from '@postdot/ui/components/button'

import { requestConsentPrompt } from '@/lib/consent'

/** Reopens the analytics choice; used by the privacy page. */
export function PrivacySettingsButton() {
    return (
        <Button variant="outline" onClick={requestConsentPrompt}>
            Change my analytics choice
        </Button>
    )
}
