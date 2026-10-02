import Markdown from 'react-markdown'

/** Local article simulation: never execute HTML or fetch embedded resources. */
export function PublicationArticleBody({ body }: { readonly body: string }) {
    return (
        <div
            data-publication-preview-content="true"
            className="min-w-0 break-words text-base leading-7 [&_p]:my-3 [&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-bold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-current [&_blockquote]:pl-4 [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-black/5 [&_pre]:p-3 dark:[&_pre]:bg-white/5 [&_code]:font-mono [&_code]:text-sm [&_hr]:my-4">
            <Markdown
                components={{
                    // Preview links express formatting without navigating away from editing.
                    a: ({ children }) => <span className="text-primary underline">{children}</span>,
                    img: ({ alt }) => <span>{alt}</span>,
                }}>
                {body}
            </Markdown>
        </div>
    )
}
