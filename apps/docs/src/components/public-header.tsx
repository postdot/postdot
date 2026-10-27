import { Button } from '@postdot/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@postdot/ui/components/popover'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { useEffect, useState } from 'react'

import { PostdotLogo } from './brand'
import { PublicThemeToggle } from './public-theme-toggle'
import { PublicWordmark } from './public-wordmark'
import { Link } from './site-link'

const links = [
    { href: '/#product', label: 'Studio' },
    { href: '/#automation', label: 'For agents' },
    { href: '/docs/', label: 'Documentation' },
]

export function PublicHeader() {
    const { scrollY } = useScroll()
    const [raised, setRaised] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    useEffect(() => setRaised(window.scrollY > 24), [])
    useMotionValueEvent(scrollY, 'change', () => setRaised(window.scrollY > 24))
    return (
        <header className="home-header-shell" data-raised={raised}>
            <a href="#main-content" className="home-skip-link">
                Skip to content
            </a>
            <div className="home-header">
                <Link href="/" className="home-brand" aria-label="Postdot home">
                    <PostdotLogo className="home-logo" />
                    <PublicWordmark />
                </Link>
                <nav aria-label="Main navigation">
                    {links.map(link => (
                        <Link href={link.href} key={link.href}>
                            {link.label}
                        </Link>
                    ))}
                </nav>
                <div className="home-header-actions">
                    <PublicThemeToggle />
                    <Button
                        nativeButton={false}
                        className="home-action home-header-install"
                        render={<Link href="/docs/installation/" />}>
                        Install
                    </Button>
                    <div className="home-mobile-menu">
                        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                            <PopoverTrigger
                                render={<Button variant="ghost" className="home-menu-trigger" />}
                                aria-label="Menu">
                                <span className="home-burger" aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                            </PopoverTrigger>
                            <PopoverContent
                                align="end"
                                sideOffset={10}
                                className="home-navigation-popup">
                                <nav aria-label="Main navigation" className="home-navigation-list">
                                    {links.map(link => (
                                        <Link
                                            href={link.href}
                                            key={link.href}
                                            className="home-navigation-item"
                                            onClick={() => setMenuOpen(false)}>
                                            {link.label}
                                        </Link>
                                    ))}
                                </nav>
                                <Button
                                    nativeButton={false}
                                    className="home-action home-navigation-install"
                                    render={
                                        <Link
                                            href="/docs/installation/"
                                            onClick={() => setMenuOpen(false)}
                                        />
                                    }>
                                    Install
                                </Button>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </div>
        </header>
    )
}
