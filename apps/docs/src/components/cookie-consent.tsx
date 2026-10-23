import { Button } from '@postdot/ui/components/button'
import { Switch } from '@postdot/ui/components/switch'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@postdot/ui/components/tooltip'
import { AltArrowDownIcon } from '@solar-icons/react/linear/alt-arrow-down'
import { ShieldKeyholeIcon } from '@solar-icons/react/linear/shield-keyhole'
import { TuningIcon } from '@solar-icons/react/linear/tuning'
import { useEffect, useState } from 'react'

import {
    type Consent,
    consentCategories,
    onConsentPromptRequest,
    requestConsentPrompt,
    useConsent,
    writeConsent,
} from '@/lib/consent'

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

    const open = consent === null || view !== null
    if (!open) return <ConsentLauncher />

    function apply(next: Consent) {
        const changed = (consent?.analytics ?? false) !== next.analytics
        writeConsent(next)
        setView(null)
        // A page runs either the audience script or the extra scripts, never both.
        if (changed) location.reload()
    }

    return (
        <ConsentPanel
            view={view ?? 'intro'}
            initial={consent ?? { analytics: false }}
            onView={setView}
            onApply={apply}
        />
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
        <section aria-labelledby="consent-title" className="consent">
            <div className="consent-head">
                <span className="consent-icon">
                    <ShieldKeyholeIcon size={22} aria-hidden="true" />
                </span>
                <div>
                    <h2 id="consent-title">Your privacy</h2>
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
        </section>
    )
}

/** Stays on every page once a choice exists, so the choice can be changed. */
function ConsentLauncher() {
    return (
        <TooltipProvider delay={300}>
            <Tooltip>
                <TooltipTrigger
                    render={<button type="button" className="consent-launcher" />}
                    aria-label="Cookie preferences"
                    onClick={requestConsentPrompt}>
                    <TuningIcon size={16} aria-hidden="true" />
                    <span>Cookies</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="home-theme-tooltip">
                    Cookie preferences
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
