import { Button } from '@postdot/ui/components/button'
import { Sheet, SheetContent, SheetTitle } from '@postdot/ui/components/sheet'
import { Switch } from '@postdot/ui/components/switch'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { useEffect, useState } from 'react'

import {
    type Consent,
    consentCategories,
    onConsentPromptRequest,
    useConsent,
    writeConsent,
} from '@/lib/consent'

import { CookieIcon } from './cookie-icon'

import './cookie-consent.css'
import { Link } from './site-link'

type View = 'intro' | 'settings'

/**
 * Asks what may run on the site. The first view offers the three usual
 * answers, with accepting as the suggested one; "Customize" opens one switch
 * per category. A floating button and the footer reopen the settings. Nothing
 * optional runs before an answer.
 */
export function CookieConsent() {
    const consent = useConsent()
    const [view, setView] = useState<View | null>(null)

    useEffect(() => onConsentPromptRequest(() => setView('settings')), [])

    if (consent === undefined) return null

    // Without a stored choice the panel cannot be dismissed; once there is one,
    // Escape or a click outside closes it and keeps that choice.
    const open = consent === null || view !== null

    function apply(next: Consent) {
        const changed = (consent?.analytics ?? false) !== next.analytics
        writeConsent(next)
        setView(null)
        // A page runs either the audience script or the extra scripts, never both.
        if (changed) location.reload()
    }

    return (
        <Sheet
            open={open}
            modal={false}
            disablePointerDismissal={consent === null || view !== 'settings'}
            onOpenChange={next => {
                if (!next && consent !== null) setView(null)
            }}>
            <SheetContent side="bottom" overlay={false} showCloseButton={false} className="consent">
                <ConsentPanel
                    view={view ?? 'intro'}
                    initial={consent ?? { analytics: false }}
                    onView={setView}
                    onApply={apply}
                />
            </SheetContent>
        </Sheet>
    )
}

function ConsentPanel({
    view,
    initial,
    onView,
    onApply,
}: {
    view: View
    initial: Consent
    onView: (view: View) => void
    onApply: (consent: Consent) => void
}) {
    const [draft, setDraft] = useState(initial)
    const [expanded, setExpanded] = useState<string | null>(null)

    return (
        <>
            <div className="consent-head">
                <span className="consent-icon">
                    <CookieIcon size={22} />
                </span>
                <div>
                    <SheetTitle className="consent-title">Your privacy</SheetTitle>
                    <p>
                        {view === 'intro'
                            ? 'We use a few tools to keep this site running and to understand how it is used, so we can improve it. You decide what is allowed. '
                            : 'Choose what may run on this site. You can change it at any time. '}
                        <Link href="/privacy">Privacy policy</Link>
                    </p>
                </div>
            </div>

            {view === 'settings' ? (
                <ul className="consent-categories">
                    {consentCategories.map(category => (
                        <li key={category.id}>
                            <div className="consent-row">
                                <button
                                    type="button"
                                    className="consent-toggle"
                                    aria-expanded={expanded === category.id}
                                    aria-controls={`consent-${category.id}`}
                                    onClick={() =>
                                        setExpanded(expanded === category.id ? null : category.id)
                                    }>
                                    <span>{category.label}</span>
                                    <AltArrowDownIcon size={16} aria-hidden="true" />
                                </button>
                                <Switch
                                    aria-label={category.label}
                                    checked={category.required || draft.analytics}
                                    disabled={category.required}
                                    onCheckedChange={checked => setDraft({ analytics: checked })}
                                />
                            </div>
                            <div
                                id={`consent-${category.id}`}
                                className="consent-detail"
                                hidden={expanded !== category.id}>
                                <p>{category.description}</p>
                                <p>{category.details}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            <div className="consent-actions">
                <Button className="consent-primary" onClick={() => onApply({ analytics: true })}>
                    Accept all
                </Button>
                {view === 'intro' ? (
                    <Button className="consent-secondary" onClick={() => onView('settings')}>
                        Customize
                    </Button>
                ) : (
                    <Button className="consent-secondary" onClick={() => onApply(draft)}>
                        Save preferences
                    </Button>
                )}
                <Button className="consent-tertiary" onClick={() => onApply({ analytics: false })}>
                    Decline all
                </Button>
            </div>
        </>
    )
}
