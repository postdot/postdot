import { Button } from '@postdot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postdot/ui/components/dropdown-menu'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { useEffect, useState } from 'react'

import { PostbotLogo } from './brand'
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
    useEffect(() => setRaised(window.scrollY > 24), [])
    useMotionValueEvent(scrollY, 'change', () => setRaised(window.scrollY > 24))
    return (
        <header className="home-header-shell" data-raised={raised}>
            <a href="#main-content" className="home-skip-link">
                Skip to content
            </a>
            <div className="home-header">
                <Link href="/" className="home-brand" aria-label="Postdot home">
                    <PostbotLogo className="home-logo" />
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
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={<Button variant="ghost" className="home-menu-trigger" />}>
                                Menu
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="home-navigation-popup">
                                {links.map(link => (
                                    <DropdownMenuItem
                                        key={link.href}
                                        render={<Link href={link.href} />}
                                        className="home-navigation-item">
                                        {link.label}
                                    </DropdownMenuItem>
                                ))}
                                <DropdownMenuItem
                                    render={<Link href="/docs/installation/" />}
                                    className="home-navigation-item">
                                    Installation
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>
        </header>
    )
}
