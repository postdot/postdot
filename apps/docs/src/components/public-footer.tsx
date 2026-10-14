import github from '@iconify-icons/logos/github-icon'
import linkedin from '@iconify-icons/logos/linkedin-icon'
import x from '@iconify-icons/logos/x'
import Link from 'next/link'

import { PostbotLogo } from './brand'
import { PublicWordmark } from './public-wordmark'

export function PublicFooter() {
    return (
        <footer className="home-footer">
            <div className="home-footer-content">
                <Link href="/" className="home-footer-mark" aria-label="Postbot home">
                    <PostbotLogo className="home-footer-logo" />
                </Link>
                <nav aria-label="Documentation links" className="home-footer-nav">
                    <div>
                        <h2>Postbot</h2>
                        <Link href="/#product">Studio</Link>
                        <Link href="/#planning">Planning</Link>
                        <Link href="/#automation">For agents</Link>
                    </div>
                    <div>
                        <h2>Guides</h2>
                        <Link href="/docs/installation/">Installation</Link>
                        <Link href="/docs/automation/">API and CLI</Link>
                        <Link href="/docs/operations/">Operations</Link>
                    </div>
                    <div className="home-footer-social">
                        <h2>Find Postbot</h2>
                        <a
                            href="https://github.com/saoudi-h/herald"
                            className="home-footer-social-link">
                            <svg
                                viewBox={`0 0 ${github.width} ${github.height}`}
                                width="20"
                                height="20"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: github.body }}
                            />
                            GitHub
                        </a>
                        <span
                            className="home-footer-social-unavailable"
                            aria-disabled="true"
                            title="Project account not available">
                            <svg
                                viewBox={`0 0 ${x.width} ${x.height}`}
                                width="18"
                                height="18"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: x.body }}
                            />
                            X
                        </span>
                        <span
                            className="home-footer-social-unavailable"
                            aria-disabled="true"
                            title="Project account not available">
                            <svg
                                viewBox={`0 0 ${linkedin.width} ${linkedin.height}`}
                                width="20"
                                height="20"
                                aria-hidden="true"
                                dangerouslySetInnerHTML={{ __html: linkedin.body }}
                            />
                            LinkedIn
                        </span>
                    </div>
                </nav>
            </div>

            <div className="home-footer-bottom">
                <span>© 2026 Hakim Saoudi</span>
                <span>Open source</span>
            </div>
            <div className="home-footer-signature" aria-hidden="true">
                <PublicWordmark />
            </div>
        </footer>
    )
}
