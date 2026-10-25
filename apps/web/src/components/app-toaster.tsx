import { Toaster } from '@postdot/ui/components/toast'

import { useLanguage } from '@/lib/i18n'
import * as m from '@/paraglide/messages.js'

export function AppToaster() {
    useLanguage()
    return <Toaster closeLabel={m.toast_dismiss()} viewportLabel={m.toast_region()} />
}
