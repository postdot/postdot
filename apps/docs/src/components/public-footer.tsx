import GitHub from '~icons/logos/github-icon'
import LinkedIn from '~icons/logos/linkedin-icon'
import X from '~icons/logos/x'

import { requestConsentPrompt } from '@/lib/consent'

import { PostbotLogo } from './brand'
import { CookieIcon } from './cookie-icon'
import { PublicMaterial } from './public-material'
import { PublicWordmark } from './public-wordmark'
import { Link } from './site-link'

export function PublicFooter() {
    return (
        <footer className="home-footer">
            <PublicMaterial footer />
            <div className="home-footer-content">
                <Link href="/" className="home-footer-mark" aria-label="Postdot home">
                    <PostbotLogo className="home-footer-logo" />
                </Link>
                <nav aria-label="Documentation links" className="home-footer-nav">
                    <div>
                        <h2>Postdot</h2>
                        <Link href="/#product">Studio</Link>
                        <Link href="/#studio-tour">Studio tour</Link>
                        <Link href="/#automation">For agents</Link>
                        <Link href="/#questions">Questions</Link>
                    </div>
                    <div>
                        <h2>Guides</h2>
                        <Link href="/docs/installation/">Installation</Link>
                        <Link href="/docs/automation/">API and CLI</Link>
                        <Link href="/docs/operations/">Operations</Link>
                    </div>
                    <div className="home-footer-social">
                        <h2>Find Postdot</h2>
                        <a
                            href="https://github.com/postdot/postdot"
                            className="home-footer-social-link">
                            <GitHub width="20" height="20" aria-hidden="true" />
                            GitHub
                        </a>
                        <span
                            className="home-footer-social-unavailable"
                            aria-disabled="true"
                            title="Project account not available">
                            <X width="18" height="18" aria-hidden="true" />X
                        </span>
                        <span
                            className="home-footer-social-unavailable"
                            aria-disabled="true"
                            title="Project account not available">
                            <LinkedIn width="20" height="20" aria-hidden="true" />
                            LinkedIn
                        </span>
                    </div>
                </nav>
            </div>

            <div className="home-footer-bottom">
                <span>© 2026 Hakim Saoudi</span>
                <span>Open source</span>
                <Link href="/legal">Legal notice</Link>
                <Link href="/privacy">Privacy</Link>
                <button type="button" className="home-footer-link" onClick={requestConsentPrompt}>
                    <CookieIcon size={14} />
                    Cookie settings
                </button>
            </div>
            <div className="home-footer-signature" aria-hidden="true">
                <PublicWordmark />
            </div>
        </footer>
    )
}
