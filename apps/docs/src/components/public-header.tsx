'use client'

import { Button } from '@postbot/ui/components/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@postbot/ui/components/dropdown-menu'
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import Link from 'next/link'
import { useState } from 'react'

import { PostbotLogo } from './brand'
import { PublicThemeToggle } from './public-theme-toggle'
import { PublicWordmark } from './public-wordmark'

const links = [
    { href: '/#workflow', label: 'Workflow' },
    { href: '/#automation', label: 'For agents' },
    { href: '/docs/', label: 'Documentation' },
]

export function PublicHeader() {
    const { scrollY } = useScroll()
    const reducedMotion = useReducedMotion()
    const [raised, setRaised] = useState(false)
    useMotionValueEvent(scrollY, 'change', value => setRaised(value > 24))
    return (
        <motion.header className="home-header-shell" data-raised={raised}>
            <motion.div
                className="home-header"
                animate={{
                    maxWidth: raised ? 1040 : 1240,
                    paddingTop: raised ? 10 : 16,
                    paddingBottom: raised ? 10 : 16,
                    y: raised ? 10 : 0,
                }}
                transition={{ duration: reducedMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}>
                <Link href="/" className="home-brand" aria-label="Postbot home">
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
            </motion.div>
        </motion.header>
    )
}
