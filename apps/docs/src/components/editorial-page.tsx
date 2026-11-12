import defaultMdxComponents from 'fumadocs-ui/mdx'
import { type ComponentProps, type ReactNode, use } from 'react'

import { type EditorialPage, type EditorialSection, getEditorialSection } from '@/lib/editorial'

import { PublicFooter } from './public-footer'
import { PublicHeader } from './public-header'
import { Link } from './site-link'

import './public-home.css'
import './editorial-page.css'

const components = {
    ...defaultMdxComponents,
    a: ({ href = '', ...props }: ComponentProps<'a'>) => {
        // Downloads and static Markdown must bypass the application router.
        return /\.(?:md|csv|sh|py|zip|yaml)(?:$|[?#])/.test(href) ||
            href.startsWith('/research/') ? (
            <a href={href} {...props} />
        ) : (
            <Link href={href} {...props} />
        )
    },
    table: (props: ComponentProps<'table'>) => (
        <div className="editorial-table" role="region" aria-label="Comparison table" tabIndex={0}>
            <table {...props} />
        </div>
    ),
    img: (props: ComponentProps<'img'>) => <img loading="lazy" {...props} />,
}

export function EditorialShell({ children }: { children: ReactNode }) {
    return (
        <div className="public-home editorial-site">
            <PublicHeader />
            <main id="main-content" tabIndex={-1}>
                {children}
            </main>
            <PublicFooter />
        </div>
    )
}

export function EditorialIndex({
    section,
    pages,
}: {
    section: EditorialSection
    pages: EditorialPage[]
}) {
    const { title, description } = getEditorialSection(section)
    return (
        <EditorialShell>
            <div className="editorial-index">
                <h1>{title}</h1>
                <p className="editorial-intro">{description}</p>
                {section === 'blog' ? (
                    <a className="editorial-read" href="/blog/rss.xml">
                        RSS feed
                    </a>
                ) : null}
                <div className="editorial-list">
                    {pages.map(page => (
                        <article key={page.url}>
                            {section === 'blog' && page.data.date ? (
                                <time dateTime={page.data.date}>{formatDate(page.data.date)}</time>
                            ) : null}
                            <h2>
                                <Link href={page.url}>{page.data.title}</Link>
                            </h2>
                            <p>{page.data.description}</p>
                            <Link className="editorial-read" href={page.url}>
                                {section === 'blog' ? 'Read article' : 'Read more'}
                                <span className="sr-only">: {page.data.title}</span>
                            </Link>
                        </article>
                    ))}
                </div>
            </div>
        </EditorialShell>
    )
}

function formatDate(value: string) {
    return new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`))
}

export function EditorialArticle({
    page,
    section,
}: {
    page: EditorialPage
    section: EditorialSection
}) {
    const { toc } = use(page.data.load())
    const Content = page.data.body
    const area = getEditorialSection(section)
    return (
        <EditorialShell>
            <article className="editorial-article">
                <header className="editorial-heading">
                    <nav aria-label="Breadcrumb">
                        <Link href="/">Home</Link>
                        <span aria-hidden="true">/</span>
                        <Link href={`/${section}`}>{area.title}</Link>
                    </nav>
                    <h1>{page.data.title}</h1>
                    <p className="editorial-intro">{page.data.description}</p>
                    <div className="editorial-meta">
                        {page.data.author ? <span>By {page.data.author}</span> : null}
                        {page.data.date ? (
                            <span>
                                {section === 'blog' ? '' : 'Reviewed '}
                                <time dateTime={page.data.date}>{formatDate(page.data.date)}</time>
                            </span>
                        ) : null}
                        <a href={`${page.url}.md`}>Read as Markdown</a>
                    </div>
                </header>
                <div className="editorial-layout">
                    <div className="editorial-prose">
                        <Content components={components} />
                    </div>
                    <aside className="editorial-toc" aria-label="On this page">
                        <p>On this page</p>
                        <nav>
                            {toc
                                .filter(item => item.depth === 2)
                                .map(item => (
                                    <a key={item.url} href={item.url}>
                                        {item.title}
                                    </a>
                                ))}
                        </nav>
                        <Link href="/docs/installation/" className="home-action">
                            Install Postdot
                        </Link>
                    </aside>
                </div>
            </article>
        </EditorialShell>
    )
}
