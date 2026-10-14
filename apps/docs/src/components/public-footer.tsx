import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicWordmark } from './public-wordmark'

export function PublicFooter() {
    return (
        <footer className="home-footer">
            <div className="home-footer-content">
                <Link href="/" className="home-footer-mark" aria-label="Postbot home">
                    <PostbotLogo className="home-footer-logo" />
                    <PublicWordmark />
                </Link>
                <nav aria-label="Documentation links" className="home-footer-nav">
                    <div>
                        <h2>Postbot</h2>
                        <Link href="/#workflow">Workflow</Link>
                        <Link href="/#planning">Planning</Link>
                        <Link href="/#automation">For agents</Link>
                    </div>
                    <div>
                        <h2>Guides</h2>
                        <Link href="/docs/installation/">Installation</Link>
                        <Link href="/docs/automation/">API and CLI</Link>
                        <Link href="/docs/operations/">Operations</Link>
                    </div>
                </nav>
            </div>

            <div className="home-footer-bottom">
                <span>© 2026 Hakim Saoudi</span>
                <span>Open source</span>
            </div>
        </footer>
    )
}
